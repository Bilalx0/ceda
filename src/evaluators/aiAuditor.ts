import * as core from '@actions/core';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { safeParseAuditResult, type CedaAuditResult, type LLMContext } from '../types/ceda.js';

interface AIAuditorConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

const SYSTEM_PROMPT = `You are a senior security and logic auditor for code reviews. Your job is to detect critical issues in AI-generated code.

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

function buildUserPrompt(diff: string, context: LLMContext, modifiedFiles: string[]): string {
  const contextBlock = `
CONTEXT:
- Valid npm dependencies in this project: ${JSON.stringify(context.validDependencies)}
- Newly defined symbols in this PR: ${JSON.stringify(context.newSymbols)}
- Modified files: ${JSON.stringify(modifiedFiles)}
- Lines marked with // ceda-ignore (skip these): ${JSON.stringify([...context.ignoredLines])}

DIFF TO AUDIT:
${diff}

Analyze the diff above. Remember: ignore style issues, focus only on hallucinations, security leaks, test cheating, and logic bugs. Return JSON only.`;

  return contextBlock;
}

async function callAnthropic(
  client: Anthropic,
  model: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain text content');
  }

  return textBlock.text;
}

async function callOpenAI(
  client: OpenAI,
  model: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response did not contain content');
  }

  return content;
}

function extractJsonFromResponse(response: string): string {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in LLM response');
  }
  return jsonMatch[0];
}

export async function auditWithAI(
  diff: string,
  context: LLMContext,
  modifiedFiles: string[],
  config: AIAuditorConfig
): Promise<CedaAuditResult> {
  const model =
    config.model || (config.provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o');
  const maxTokens = config.maxTokens || 4000;

  core.info(`AI Auditor: Calling ${config.provider} with model ${model}`);

  const userPrompt = buildUserPrompt(diff, context, modifiedFiles);

  let rawResponse: string;

  try {
    if (config.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: config.apiKey });
      rawResponse = await callAnthropic(client, model, userPrompt, maxTokens);
    } else {
      const client = new OpenAI({ apiKey: config.apiKey });
      rawResponse = await callOpenAI(client, model, userPrompt, maxTokens);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`AI Auditor: LLM call failed: ${errorMessage}`);
    throw new Error(`LLM call failed: ${errorMessage}`, { cause: error });
  }

  core.info(`AI Auditor: Received response (${rawResponse.length} chars)`);

  try {
    const jsonString = extractJsonFromResponse(rawResponse);
    const parsed = JSON.parse(jsonString);
    const result = safeParseAuditResult(parsed);

    if (!result.success) {
      core.warning(`AI Auditor: Zod validation failed: ${result.error}`);
      throw new Error(`LLM response failed schema validation: ${result.error}`);
    }

    core.info(
      `AI Auditor: Audit complete. Risk score: ${result.data.riskScore}, Issues: ${result.data.issues.length}`
    );
    return result.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`AI Auditor: Failed to parse LLM response: ${errorMessage}`);
    throw new Error(`Failed to parse LLM response: ${errorMessage}`, { cause: error });
  }
}

export function createFailOpenResult(reason: string): CedaAuditResult {
  core.warning(`AI Auditor: Failing open due to: ${reason}`);

  return {
    overallRisk: 'WARNING',
    riskScore: 50,
    summary: `AI audit could not be completed: ${reason}. Please review manually.`,
    issues: [
      {
        file: 'CEDA_SYSTEM',
        severity: 'MEDIUM',
        type: 'LOGIC_BUG',
        title: 'AI Audit Unavailable',
        description: `The AI auditor encountered an error: ${reason}. This is not a code issue, but a system limitation. Please perform manual review.`,
        suggestedFix: 'Review the PR manually or retry the CI pipeline.',
      },
    ],
    testFileModified: false,
  };
}
