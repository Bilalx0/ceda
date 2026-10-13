import * as core from '@actions/core';
import * as github from '@actions/github';
import { buildLLMContext } from './parsers/astParser.js';
import { evaluateTestCheating } from './evaluators/testGuard.js';
import { detectSecrets } from './evaluators/secretDetector.js';
import { auditWithAI, createFailOpenResult } from './evaluators/aiAuditor.js';
import { buildComment, shouldPostComment } from './formatters/commentBuilder.js';
import type { CedaAuditResult, CedaIssue } from './types/ceda.js';

interface CedaInputs {
  githubToken: string;
  llmApiKey: string;
  llmProvider: 'anthropic' | 'openai';
  riskThreshold: number;
  verbose: boolean;
}

interface FileDiff {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch: string;
}

interface ParsedDiff {
  files: FileDiff[];
  modifiedFiles: string[];
  totalAdditions: number;
  totalDeletions: number;
}

function getInputs(): CedaInputs {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    llmApiKey: core.getInput('llm-api-key', { required: true }),
    llmProvider: (core.getInput('llm-provider') || 'anthropic') as 'anthropic' | 'openai',
    riskThreshold: parseInt(core.getInput('risk-threshold') || '30', 10),
    verbose: core.getInput('verbose') === 'true',
  };
}

async function fetchAndParseDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ParsedDiff> {
  core.info(`Diff Parser: Fetching diff for PR #${pullNumber}`);

  try {
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const fileDiffs: FileDiff[] = files.map((file) => ({
      filename: file.filename,
      status: file.status as FileDiff['status'],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch || '',
    }));

    const modifiedFiles = fileDiffs.filter((f) => f.status !== 'removed').map((f) => f.filename);

    const totalAdditions = fileDiffs.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = fileDiffs.reduce((sum, f) => sum + f.deletions, 0);

    core.info(
      `Diff Parser: Found ${fileDiffs.length} files changed (+${totalAdditions}/-${totalDeletions})`
    );

    return {
      files: fileDiffs,
      modifiedFiles,
      totalAdditions,
      totalDeletions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Diff Parser: Failed to fetch diff: ${errorMessage}`);
    throw new Error(`Failed to fetch PR diff: ${errorMessage}`, { cause: error });
  }
}

function shouldSkipFile(filename: string): boolean {
  const skipExtensions = ['.md', '.txt', '.json', '.yml', '.yaml', '.css', '.scss'];
  const skipPatterns = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

  const ext = filename.substring(filename.lastIndexOf('.'));

  if (skipExtensions.includes(ext)) {
    return true;
  }

  if (skipPatterns.some((pattern) => filename.endsWith(pattern))) {
    return true;
  }

  return false;
}

function filterRelevantFiles(diff: ParsedDiff): ParsedDiff {
  const relevantFiles = diff.files.filter((f) => !shouldSkipFile(f.filename));

  const modifiedFiles = relevantFiles.filter((f) => f.status !== 'removed').map((f) => f.filename);

  const totalAdditions = relevantFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = relevantFiles.reduce((sum, f) => sum + f.deletions, 0);

  core.info(`Diff Parser: Filtered to ${relevantFiles.length} relevant files`);

  return {
    files: relevantFiles,
    modifiedFiles,
    totalAdditions,
    totalDeletions,
  };
}

function getFullDiffContent(diff: ParsedDiff): string {
  return diff.files.map((f) => `--- ${f.filename}\n${f.patch}`).join('\n\n');
}

async function getFileContents(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  ref: string,
  files: string[]
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const file of files) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: file,
        ref,
      });

      if ('content' in data && typeof data.content === 'string') {
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        contents.set(file, decoded);
      }
    } catch (error) {
      core.warning(
        `Could not fetch content for ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return contents;
}

function mergeIssues(...issueArrays: CedaIssue[][]): CedaIssue[] {
  return issueArrays.flat();
}

function calculateOverallRisk(issues: CedaIssue[]): CedaAuditResult['overallRisk'] {
  const hasCritical = issues.some((i) => i.severity === 'CRITICAL');
  const hasHigh = issues.some((i) => i.severity === 'HIGH');

  if (hasCritical) {
    return 'BLOCK';
  }

  if (hasHigh) {
    return 'WARNING';
  }

  return 'PASS';
}

function calculateRiskScore(issues: CedaIssue[]): number {
  let score = 0;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'CRITICAL':
        score += 40;
        break;
      case 'HIGH':
        score += 25;
        break;
      case 'MEDIUM':
        score += 10;
        break;
      case 'LOW':
        score += 5;
        break;
    }
  }

  return Math.min(score, 100);
}

async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  comment: string
): Promise<void> {
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: comment,
    });

    core.info('Successfully posted CEDA audit comment to PR');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to post comment: ${errorMessage}`);
    throw new Error(`Failed to post PR comment: ${errorMessage}`, { cause: error });
  }
}

async function run(): Promise<void> {
  try {
    core.info('CEDA Auditor: Starting audit pipeline');

    const inputs = getInputs();
    const context = github.context;

    if (!context.payload.pull_request) {
      core.info('CEDA Auditor: Not a pull request event, skipping');
      return;
    }

    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pullNumber = context.payload.pull_request.number;
    const headRef = context.payload.pull_request.head.ref;

    core.info(`CEDA Auditor: Processing PR #${pullNumber} in ${owner}/${repo}`);

    const octokit = github.getOctokit(inputs.githubToken);

    core.info('Step 1: Fetching and parsing PR diff');
    const rawDiff = await fetchAndParseDiff(octokit, owner, repo, pullNumber);
    const diff = filterRelevantFiles(rawDiff);

    if (diff.files.length === 0) {
      core.info('CEDA Auditor: No relevant files changed, exiting');
      return;
    }

    const fullDiffContent = getFullDiffContent(diff);

    core.info('Step 2: Running deterministic guards');
    const testCheatingIssues = evaluateTestCheating(diff.modifiedFiles);

    const secretIssues: CedaIssue[] = [];
    for (const file of diff.files) {
      const fileSecrets = detectSecrets(file.patch, file.filename);
      secretIssues.push(...fileSecrets);
    }

    const deterministicIssues = mergeIssues(testCheatingIssues, secretIssues);

    if (deterministicIssues.some((i) => i.severity === 'CRITICAL')) {
      core.warning('CEDA Auditor: Critical deterministic issues found, skipping AI audit');

      const failResult: CedaAuditResult = {
        overallRisk: 'BLOCK',
        riskScore: calculateRiskScore(deterministicIssues),
        summary: 'Critical security or test integrity issues detected. AI audit skipped.',
        issues: deterministicIssues,
        testFileModified: testCheatingIssues.length > 0,
      };

      const comment = buildComment(failResult);
      await postComment(octokit, owner, repo, pullNumber, comment);
      return;
    }

    core.info('Step 3: Building LLM context');
    const projectRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const fileContents = await getFileContents(octokit, owner, repo, headRef, diff.modifiedFiles);
    const llmContext = await buildLLMContext(
      projectRoot,
      diff.modifiedFiles,
      fileContents,
      fullDiffContent
    );

    core.info('Step 4: Running AI audit');
    let aiResult: CedaAuditResult;

    try {
      aiResult = await auditWithAI(fullDiffContent, llmContext, diff.modifiedFiles, {
        provider: inputs.llmProvider,
        apiKey: inputs.llmApiKey,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      core.warning(`CEDA Auditor: AI audit failed, failing open: ${errorMessage}`);
      aiResult = createFailOpenResult(errorMessage);
    }

    core.info('Step 5: Merging results and generating report');
    const allIssues = mergeIssues(deterministicIssues, aiResult.issues);

    const finalResult: CedaAuditResult = {
      overallRisk: calculateOverallRisk(allIssues),
      riskScore: calculateRiskScore(allIssues),
      summary: aiResult.summary,
      issues: allIssues,
      testFileModified: testCheatingIssues.length > 0 || aiResult.testFileModified,
    };

    if (shouldPostComment(finalResult, inputs.riskThreshold)) {
      const comment = buildComment(finalResult);
      await postComment(octokit, owner, repo, pullNumber, comment);
    } else {
      core.info('CEDA Auditor: Risk below threshold, no comment posted');
    }

    if (finalResult.overallRisk === 'BLOCK') {
      core.setFailed('CEDA Auditor: Critical issues detected, blocking PR');
    }

    core.info('CEDA Auditor: Audit pipeline completed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`CEDA Auditor failed: ${errorMessage}`);
  }
}

run();
