import * as core from '@actions/core';
import type { Octokit } from '@octokit/rest';

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

export async function fetchAndParseDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ParsedDiff> {
  core.info(`Diff Parser: Fetching diff for PR #${pullNumber}`);

  try {
    const { data: files } = await octokit.pulls.listFiles({
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

export function shouldSkipFile(filename: string): boolean {
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

export function filterRelevantFiles(diff: ParsedDiff): ParsedDiff {
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

export function getFullDiffContent(diff: ParsedDiff): string {
  return diff.files.map((f) => `--- ${f.filename}\n${f.patch}`).join('\n\n');
}
