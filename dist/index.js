// src/index.ts
import * as core5 from "@actions/core";
import * as github from "@actions/github";

// src/parsers/astParser.ts
import * as core from "@actions/core";
import * as fs from "fs/promises";
import * as path from "path";
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
var parser = new Parser();
var typescriptParser = TypeScript;
parser.setLanguage(typescriptParser);
async function extractValidDependencies(projectRoot) {
  try {
    const packageJsonPath = path.join(projectRoot, "package.json");
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    const dependencies = Object.keys(packageJson.dependencies || {});
    const devDependencies = Object.keys(packageJson.devDependencies || {});
    const allDeps = [...dependencies, ...devDependencies];
    core.info(`AST Parser: Found ${allDeps.length} valid dependencies in package.json`);
    return allDeps;
  } catch (error4) {
    core.warning(
      `AST Parser: Could not read package.json: ${error4 instanceof Error ? error4.message : String(error4)}`
    );
    return [];
  }
}
function extractNewSymbols(fileContent, filePath) {
  const symbols = [];
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js") && !filePath.endsWith(".jsx")) {
    return symbols;
  }
  try {
    const tree = parser.parse(fileContent);
    const rootNode = tree.rootNode;
    const functionDeclarations = rootNode.descendantsOfType("function_declaration");
    for (const func of functionDeclarations) {
      const nameNode = func.childForFieldName("name");
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }
    const classDeclarations = rootNode.descendantsOfType("class_declaration");
    for (const cls of classDeclarations) {
      const nameNode = cls.childForFieldName("name");
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }
    const interfaceDeclarations = rootNode.descendantsOfType("interface_declaration");
    for (const iface of interfaceDeclarations) {
      const nameNode = iface.childForFieldName("name");
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }
    const typeAliasDeclarations = rootNode.descendantsOfType("type_alias_declaration");
    for (const typeAlias of typeAliasDeclarations) {
      const nameNode = typeAlias.childForFieldName("name");
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }
    const arrowFunctions = rootNode.descendantsOfType("lexical_declaration");
    for (const decl of arrowFunctions) {
      const variableDeclarator = decl.descendantsOfType("variable_declarator")[0];
      if (variableDeclarator) {
        const nameNode = variableDeclarator.childForFieldName("name");
        const valueNode = variableDeclarator.childForFieldName("value");
        if (nameNode && valueNode && valueNode.type === "arrow_function") {
          symbols.push(nameNode.text);
        }
      }
    }
    core.info(`AST Parser: Extracted ${symbols.length} new symbols from ${filePath}`);
  } catch (error4) {
    core.warning(
      `AST Parser: Failed to parse ${filePath}: ${error4 instanceof Error ? error4.message : String(error4)}`
    );
  }
  return symbols;
}
function extractIgnoredLines(diffContent) {
  const ignoredLines = /* @__PURE__ */ new Set();
  const lines = diffContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("// ceda-ignore") || line.includes("/* ceda-ignore */")) {
      ignoredLines.add(String(i + 1));
    }
  }
  core.info(`AST Parser: Found ${ignoredLines.size} lines marked with ceda-ignore`);
  return ignoredLines;
}
async function buildLLMContext(projectRoot, modifiedFiles, fileContents, diffContent) {
  const validDependencies = await extractValidDependencies(projectRoot);
  const newSymbols = [];
  for (const [filePath, content] of fileContents.entries()) {
    const symbols = extractNewSymbols(content, filePath);
    newSymbols.push(...symbols);
  }
  const ignoredLines = extractIgnoredLines(diffContent);
  return {
    validDependencies,
    newSymbols,
    modifiedFiles,
    ignoredLines
  };
}

// src/evaluators/testGuard.ts
import * as core2 from "@actions/core";
var TEST_FILE_PATTERNS = [
  ".test.ts",
  ".test.js",
  ".spec.ts",
  ".spec.js",
  "_test.py",
  "_spec.py",
  ".test.tsx",
  ".spec.tsx"
];
function evaluateTestCheating(modifiedFiles) {
  const issues = [];
  let hasSourceModification = false;
  let hasTestModification = false;
  const modifiedTestFiles = [];
  for (const file of modifiedFiles) {
    const isTestFile = TEST_FILE_PATTERNS.some((pattern) => file.endsWith(pattern));
    if (isTestFile) {
      hasTestModification = true;
      modifiedTestFiles.push(file);
    } else {
      hasSourceModification = true;
    }
  }
  if (hasSourceModification && hasTestModification) {
    const severity = "HIGH";
    issues.push({
      file: "MULTIPLE",
      severity,
      type: "TEST_CHEATING",
      title: "Simultaneous Source and Test Modification Detected",
      description: `This PR modifies both application code and test files (${modifiedTestFiles.join(", ")}). AI models frequently alter tests to force broken implementations to pass. Please ensure test changes are strictly for legitimate refactoring or new feature coverage, and manually verify the test assertions are valid.`,
      suggestedFix: "Consider splitting this PR: one for the feature implementation, and a separate PR for test updates if absolutely necessary."
    });
    core2.warning(`CEDA Test Guard: Detected simultaneous source and test modifications.`);
  } else {
    core2.info("CEDA Test Guard: No test cheating patterns detected.");
  }
  return issues;
}

// src/evaluators/secretDetector.ts
import * as core3 from "@actions/core";
var SECRET_PATTERNS = [
  {
    name: "AWS Access Key",
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: "CRITICAL"
  },
  {
    name: "GitHub Token",
    pattern: /ghp_[0-9a-zA-Z]{36}/,
    severity: "CRITICAL"
  },
  {
    name: "Generic API Key",
    pattern: /(api[_-]?key|apikey)\s*[:=]\s*['"][0-9a-zA-Z]{32,}['"]/i,
    severity: "HIGH"
  },
  {
    name: "Generic Secret",
    pattern: /(secret|password|passwd|pwd)\s*[:=]\s*['"][^\s'"]{8,}['"]/i,
    severity: "HIGH"
  },
  {
    name: "Private Key",
    pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: "CRITICAL"
  },
  {
    name: "JWT Token",
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/,
    severity: "HIGH"
  },
  {
    name: "Database Connection String",
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^@\s]+@[^@\s]+/i,
    severity: "CRITICAL"
  }
];
function detectSecrets(diffContent, filePath) {
  const issues = [];
  if (filePath.includes(".env.example") || filePath.includes("README")) {
    return issues;
  }
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    const matches = diffContent.match(pattern);
    if (matches) {
      issues.push({
        file: filePath,
        severity,
        type: "SECURITY_LEAK",
        title: `Potential ${name} Detected`,
        description: `Hardcoded ${name.toLowerCase()} found in code. This is a critical security risk. Secrets should never be committed to version control. Use environment variables or a secrets manager instead.`,
        suggestedFix: `Remove the ${name.toLowerCase()} and use environment variables.`
      });
      core3.error(`CEDA Secret Detector: Found ${name} in ${filePath}`);
    }
  }
  if (issues.length === 0) {
    core3.info(`CEDA Secret Detector: No secrets detected in ${filePath}`);
  }
  return issues;
}

// src/evaluators/aiAuditor.ts
import * as core4 from "@actions/core";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// src/types/ceda.ts
import { z } from "zod";
var SeverityLevelSchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
var IssueTypeSchema = z.enum([
  "HALLUCINATION",
  // LLM invented non-existent APIs/imports
  "SECURITY_LEAK",
  // Hardcoded secrets, tokens, keys
  "TEST_CHEATING",
  // Modifying tests to pass broken code
  "LOGIC_BUG"
  // Unhandled edge cases, logical flaws
]);
var CedaIssueSchema = z.object({
  file: z.string().min(1, "File path is required"),
  line: z.number().int().positive().optional(),
  severity: SeverityLevelSchema,
  type: IssueTypeSchema,
  title: z.string().min(1, "Issue title is required").max(100),
  description: z.string().min(1, "Issue description is required").max(500),
  suggestedFix: z.string().max(500).optional()
});
var CedaAuditResultSchema = z.object({
  overallRisk: z.enum(["PASS", "WARNING", "BLOCK"]),
  riskScore: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(300),
  issues: z.array(CedaIssueSchema).default([]),
  testFileModified: z.boolean().default(false)
});
function safeParseAuditResult(data) {
  try {
    const result = CedaAuditResultSchema.parse(data);
    return { success: true, data: result };
  } catch (error4) {
    const errorMessage = error4 instanceof Error ? error4.message : String(error4);
    return { success: false, error: errorMessage };
  }
}

// src/evaluators/aiAuditor.ts
var SYSTEM_PROMPT = `You are a senior security and logic auditor for code reviews. Your job is to detect critical issues in AI-generated code.

RULES:
1. DO NOT comment on code style, formatting, variable naming, or comments. Tools like ESLint and Prettier handle those.
2. ONLY flag these four categories:
   - HALLUCINATION: Code that calls non-existent APIs, imports fake libraries, or uses methods that don't exist
   - SECURITY_LEAK: Hardcoded secrets, tokens, or credentials
   - TEST_CHEATING: Tests modified to pass broken implementations
   - LOGIC_BUG: Unhandled edge cases, null pointer risks, race conditions, or logical flaws

3. Before flagging an import or function as HALLUCINATION, verify it against the provided "Valid Dependencies" and "New Symbols" lists.
4. If the code is safe and correct, return an empty issues array.
5. Be conservative. False positives erode trust. Only flag issues you are confident about.
6. Return your response as valid JSON matching this exact schema:
{
  "overallRisk": "PASS" | "WARNING" | "BLOCK",
  "riskScore": number (0-100),
  "summary": string (max 300 chars),
  "issues": [
    {
      "file": string,
      "line": number (optional),
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "type": "HALLUCINATION" | "SECURITY_LEAK" | "TEST_CHEATING" | "LOGIC_BUG",
      "title": string (max 100 chars),
      "description": string (max 500 chars),
      "suggestedFix": string (optional, max 500 chars)
    }
  ],
  "testFileModified": boolean
}`;
function buildUserPrompt(diff, context2, modifiedFiles) {
  const contextBlock = `
CONTEXT:
- Valid npm dependencies in this project: ${JSON.stringify(context2.validDependencies)}
- Newly defined symbols in this PR: ${JSON.stringify(context2.newSymbols)}
- Modified files: ${JSON.stringify(modifiedFiles)}
- Lines marked with // ceda-ignore (skip these): ${JSON.stringify([...context2.ignoredLines])}

DIFF TO AUDIT:
${diff}

Analyze the diff above. Remember: ignore style issues, focus only on hallucinations, security leaks, test cheating, and logic bugs. Return JSON only.`;
  return contextBlock;
}
async function callAnthropic(client, model, userPrompt, maxTokens) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userPrompt
      }
    ]
  });
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response did not contain text content");
  }
  return textBlock.text;
}
async function callOpenAI(client, model, userPrompt, maxTokens) {
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    response_format: { type: "json_object" }
  });
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response did not contain content");
  }
  return content;
}
function extractJsonFromResponse(response) {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in LLM response");
  }
  return jsonMatch[0];
}
async function auditWithAI(diff, context2, modifiedFiles, config) {
  const model = config.model || (config.provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gpt-4o");
  const maxTokens = config.maxTokens || 4e3;
  core4.info(`AI Auditor: Calling ${config.provider} with model ${model}`);
  const userPrompt = buildUserPrompt(diff, context2, modifiedFiles);
  let rawResponse;
  try {
    if (config.provider === "anthropic") {
      const client = new Anthropic({ apiKey: config.apiKey });
      rawResponse = await callAnthropic(client, model, userPrompt, maxTokens);
    } else {
      const client = new OpenAI({ apiKey: config.apiKey });
      rawResponse = await callOpenAI(client, model, userPrompt, maxTokens);
    }
  } catch (error4) {
    const errorMessage = error4 instanceof Error ? error4.message : String(error4);
    core4.error(`AI Auditor: LLM call failed: ${errorMessage}`);
    throw new Error(`LLM call failed: ${errorMessage}`, { cause: error4 });
  }
  core4.info(`AI Auditor: Received response (${rawResponse.length} chars)`);
  try {
    const jsonString = extractJsonFromResponse(rawResponse);
    const parsed = JSON.parse(jsonString);
    const result = safeParseAuditResult(parsed);
    if (!result.success) {
      core4.warning(`AI Auditor: Zod validation failed: ${result.error}`);
      throw new Error(`LLM response failed schema validation: ${result.error}`);
    }
    core4.info(
      `AI Auditor: Audit complete. Risk score: ${result.data.riskScore}, Issues: ${result.data.issues.length}`
    );
    return result.data;
  } catch (error4) {
    const errorMessage = error4 instanceof Error ? error4.message : String(error4);
    core4.error(`AI Auditor: Failed to parse LLM response: ${errorMessage}`);
    throw new Error(`Failed to parse LLM response: ${errorMessage}`, { cause: error4 });
  }
}
function createFailOpenResult(reason) {
  core4.warning(`AI Auditor: Failing open due to: ${reason}`);
  return {
    overallRisk: "WARNING",
    riskScore: 50,
    summary: `AI audit could not be completed: ${reason}. Please review manually.`,
    issues: [
      {
        file: "CEDA_SYSTEM",
        severity: "MEDIUM",
        type: "LOGIC_BUG",
        title: "AI Audit Unavailable",
        description: `The AI auditor encountered an error: ${reason}. This is not a code issue, but a system limitation. Please perform manual review.`,
        suggestedFix: "Review the PR manually or retry the CI pipeline."
      }
    ],
    testFileModified: false
  };
}

// src/formatters/commentBuilder.ts
var SEVERITY_ORDER = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
};
var SEVERITY_LABELS = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};
function getRiskBadge(risk) {
  switch (risk) {
    case "PASS":
      return "**PASS**";
    case "WARNING":
      return "**WARNING**";
    case "BLOCK":
      return "**BLOCK**";
  }
}
function formatIssue(issue) {
  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
  const fix = issue.suggestedFix ? `
   - **Fix**: ${issue.suggestedFix}` : "";
  return `### ${issue.title}
- **Location**: \`${location}\`
- **Severity**: ${SEVERITY_LABELS[issue.severity]}
- **Type**: ${issue.type}
- **Description**: ${issue.description}${fix}
`;
}
function groupIssuesByType(issues) {
  const grouped = /* @__PURE__ */ new Map();
  for (const issue of issues) {
    const existing = grouped.get(issue.type) || [];
    existing.push(issue);
    grouped.set(issue.type, existing);
  }
  return grouped;
}
function sortIssuesBySeverity(issues) {
  return [...issues].sort((a, b) => {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
}
function buildComment(auditResult) {
  const lines = [];
  lines.push("## CEDA Audit Report");
  lines.push("");
  lines.push(`**Overall Risk**: ${getRiskBadge(auditResult.overallRisk)}`);
  lines.push(`**Risk Score**: ${auditResult.riskScore}/100`);
  lines.push(`**Summary**: ${auditResult.summary}`);
  lines.push("");
  if (auditResult.testFileModified) {
    lines.push(
      "> **Note**: This PR modifies both source code and test files. Please verify test integrity manually."
    );
    lines.push("");
  }
  if (auditResult.issues.length === 0) {
    lines.push("**No issues detected.** Code appears safe.");
  } else {
    const grouped = groupIssuesByType(auditResult.issues);
    for (const [type, issues] of grouped.entries()) {
      const sortedIssues = sortIssuesBySeverity(issues);
      lines.push(`### ${type} Issues (${issues.length})`);
      lines.push("");
      for (const issue of sortedIssues) {
        lines.push(formatIssue(issue));
      }
    }
  }
  lines.push("---");
  lines.push(
    "*Generated by [CEDA](https://github.com/your-username/ceda-auditor) - AI Code Debt Auditor*"
  );
  return lines.join("\n");
}
function shouldPostComment(auditResult, riskThreshold) {
  if (auditResult.overallRisk === "BLOCK") {
    return true;
  }
  if (auditResult.riskScore >= riskThreshold) {
    return true;
  }
  if (auditResult.issues.some((issue) => issue.severity === "CRITICAL" || issue.severity === "HIGH")) {
    return true;
  }
  return false;
}

// src/index.ts
function getInputs() {
  return {
    githubToken: core5.getInput("github-token", { required: true }),
    llmApiKey: core5.getInput("llm-api-key", { required: true }),
    llmProvider: core5.getInput("llm-provider") || "anthropic",
    riskThreshold: parseInt(core5.getInput("risk-threshold") || "30", 10),
    verbose: core5.getInput("verbose") === "true"
  };
}
async function fetchAndParseDiff(octokit, owner, repo, pullNumber) {
  core5.info(`Diff Parser: Fetching diff for PR #${pullNumber}`);
  try {
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    });
    const fileDiffs = files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch || ""
    }));
    const modifiedFiles = fileDiffs.filter((f) => f.status !== "removed").map((f) => f.filename);
    const totalAdditions = fileDiffs.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = fileDiffs.reduce((sum, f) => sum + f.deletions, 0);
    core5.info(
      `Diff Parser: Found ${fileDiffs.length} files changed (+${totalAdditions}/-${totalDeletions})`
    );
    return {
      files: fileDiffs,
      modifiedFiles,
      totalAdditions,
      totalDeletions
    };
  } catch (error4) {
    const errorMessage = error4 instanceof Error ? error4.message : String(error4);
    core5.error(`Diff Parser: Failed to fetch diff: ${errorMessage}`);
    throw new Error(`Failed to fetch PR diff: ${errorMessage}`, { cause: error4 });
  }
}
function shouldSkipFile(filename) {
  const skipExtensions = [".md", ".txt", ".json", ".yml", ".yaml", ".css", ".scss"];
  const skipPatterns = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
  const ext = filename.substring(filename.lastIndexOf("."));
  if (skipExtensions.includes(ext)) {
    return true;
  }
  if (skipPatterns.some((pattern) => filename.endsWith(pattern))) {
    return true;
  }
  return false;
}
function filterRelevantFiles(diff) {
  const relevantFiles = diff.files.filter((f) => !shouldSkipFile(f.filename));
  const modifiedFiles = relevantFiles.filter((f) => f.status !== "removed").map((f) => f.filename);
  const totalAdditions = relevantFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = relevantFiles.reduce((sum, f) => sum + f.deletions, 0);
  core5.info(`Diff Parser: Filtered to ${relevantFiles.length} relevant files`);
  return {
    files: relevantFiles,
    modifiedFiles,
    totalAdditions,
    totalDeletions
  };
}
function getFullDiffContent(diff) {
  return diff.files.map((f) => `--- ${f.filename}
${f.patch}`).join("\n\n");
}
async function getFileContents(octokit, owner, repo, ref, files) {
  const contents = /* @__PURE__ */ new Map();
  for (const file of files) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: file,
        ref
      });
      if ("content" in data && typeof data.content === "string") {
        const decoded = Buffer.from(data.content, "base64").toString("utf-8");
        contents.set(file, decoded);
      }
    } catch (error4) {
      core5.warning(
        `Could not fetch content for ${file}: ${error4 instanceof Error ? error4.message : String(error4)}`
      );
    }
  }
  return contents;
}
function mergeIssues(...issueArrays) {
  return issueArrays.flat();
}
function calculateOverallRisk(issues) {
  const hasCritical = issues.some((i) => i.severity === "CRITICAL");
  const hasHigh = issues.some((i) => i.severity === "HIGH");
  if (hasCritical) {
    return "BLOCK";
  }
  if (hasHigh) {
    return "WARNING";
  }
  return "PASS";
}
function calculateRiskScore(issues) {
  let score = 0;
  for (const issue of issues) {
    switch (issue.severity) {
      case "CRITICAL":
        score += 40;
        break;
      case "HIGH":
        score += 25;
        break;
      case "MEDIUM":
        score += 10;
        break;
      case "LOW":
        score += 5;
        break;
    }
  }
  return Math.min(score, 100);
}
async function postComment(octokit, owner, repo, pullNumber, comment) {
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: comment
    });
    core5.info("Successfully posted CEDA audit comment to PR");
  } catch (error4) {
    const errorMessage = error4 instanceof Error ? error4.message : String(error4);
    core5.error(`Failed to post comment: ${errorMessage}`);
    throw new Error(`Failed to post PR comment: ${errorMessage}`, { cause: error4 });
  }
}
async function run() {
  try {
    core5.info("CEDA Auditor: Starting audit pipeline");
    const inputs = getInputs();
    const context2 = github.context;
    if (!context2.payload.pull_request) {
      core5.info("CEDA Auditor: Not a pull request event, skipping");
      return;
    }
    const owner = context2.repo.owner;
    const repo = context2.repo.repo;
    const pullNumber = context2.payload.pull_request.number;
    const headRef = context2.payload.pull_request.head.ref;
    core5.info(`CEDA Auditor: Processing PR #${pullNumber} in ${owner}/${repo}`);
    const octokit = github.getOctokit(inputs.githubToken);
    core5.info("Step 1: Fetching and parsing PR diff");
    const rawDiff = await fetchAndParseDiff(octokit, owner, repo, pullNumber);
    const diff = filterRelevantFiles(rawDiff);
    if (diff.files.length === 0) {
      core5.info("CEDA Auditor: No relevant files changed, exiting");
      return;
    }
    const fullDiffContent = getFullDiffContent(diff);
    core5.info("Step 2: Running deterministic guards");
    const testCheatingIssues = evaluateTestCheating(diff.modifiedFiles);
    const secretIssues = [];
    for (const file of diff.files) {
      const fileSecrets = detectSecrets(file.patch, file.filename);
      secretIssues.push(...fileSecrets);
    }
    const deterministicIssues = mergeIssues(testCheatingIssues, secretIssues);
    if (deterministicIssues.some((i) => i.severity === "CRITICAL")) {
      core5.warning("CEDA Auditor: Critical deterministic issues found, skipping AI audit");
      const failResult = {
        overallRisk: "BLOCK",
        riskScore: calculateRiskScore(deterministicIssues),
        summary: "Critical security or test integrity issues detected. AI audit skipped.",
        issues: deterministicIssues,
        testFileModified: testCheatingIssues.length > 0
      };
      const comment = buildComment(failResult);
      await postComment(octokit, owner, repo, pullNumber, comment);
      return;
    }
    core5.info("Step 3: Building LLM context");
    const projectRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const fileContents = await getFileContents(octokit, owner, repo, headRef, diff.modifiedFiles);
    const llmContext = await buildLLMContext(
      projectRoot,
      diff.modifiedFiles,
      fileContents,
      fullDiffContent
    );
    core5.info("Step 4: Running AI audit");
    let aiResult;
    try {
      aiResult = await auditWithAI(fullDiffContent, llmContext, diff.modifiedFiles, {
        provider: inputs.llmProvider,
        apiKey: inputs.llmApiKey
      });
    } catch (error4) {
      const errorMessage = error4 instanceof Error ? error4.message : String(error4);
      core5.warning(`CEDA Auditor: AI audit failed, failing open: ${errorMessage}`);
      aiResult = createFailOpenResult(errorMessage);
    }
    core5.info("Step 5: Merging results and generating report");
    const allIssues = mergeIssues(deterministicIssues, aiResult.issues);
    const finalResult = {
      overallRisk: calculateOverallRisk(allIssues),
      riskScore: calculateRiskScore(allIssues),
      summary: aiResult.summary,
      issues: allIssues,
      testFileModified: testCheatingIssues.length > 0 || aiResult.testFileModified
    };
    if (shouldPostComment(finalResult, inputs.riskThreshold)) {
      const comment = buildComment(finalResult);
      await postComment(octokit, owner, repo, pullNumber, comment);
    } else {
      core5.info("CEDA Auditor: Risk below threshold, no comment posted");
    }
    if (finalResult.overallRisk === "BLOCK") {
      core5.setFailed("CEDA Auditor: Critical issues detected, blocking PR");
    }
    core5.info("CEDA Auditor: Audit pipeline completed successfully");
  } catch (error4) {
    const errorMessage = error4 instanceof Error ? error4.message : String(error4);
    core5.setFailed(`CEDA Auditor failed: ${errorMessage}`);
  }
}
run();
