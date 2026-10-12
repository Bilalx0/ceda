import { z } from 'zod';

/**
 * Severity levels for detected issues
 * Ordered from most critical to least critical
 */

export const SeverityLevelSchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;

/**
 * Types of issues CEDA can detect
 */

export const IssueTypeSchema = z.enum([
  'HALLUCINATION', // LLM invented non-existent APIs/imports
  'SECURITY_LEAK', // Hardcoded secrets, tokens, keys
  'TEST_CHEATING', // Modifying tests to pass broken code
  'LOGIC_BUG', // Unhandled edge cases, logical flaws
]);
export type IssueType = z.infer<typeof IssueTypeSchema>;

/**
 * Individual issue detected by CEDA
 */

export const CedaIssueSchema = z.object({
  file: z.string().min(1, 'File path is required'),
  line: z.number().int().positive().optional(),
  severity: SeverityLevelSchema,
  type: IssueTypeSchema,
  title: z.string().min(1, 'Issue title is required').max(100),
  description: z.string().min(1, 'Issue description is required').max(500),
  suggestedFix: z.string().max(500).optional(),
});
export type CedaIssue = z.infer<typeof CedaIssueSchema>;

/**
 * Overall audit result from CEDA
 */

export const CedaAuditResultSchema = z.object({
  overallRisk: z.enum(['PASS', 'WARNING', 'BLOCK']),
  riskScore: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(300),
  issues: z.array(CedaIssueSchema).default([]),
  testFileModified: z.boolean().default(false),
});
export type CedaAuditResult = z.infer<typeof CedaAuditResultSchema>;

/**
 * Context passed to the LLM for accurate analysis
 */

export interface LLMContext {
  /** Valid npm dependencies from package.json */
  validDependencies: string[];

  /** Newly defined functions/classes in the PR */
  newSymbols: string[];

  /** Modified file paths */
  modifiedFiles: string[];

  /** Lines marked with // ceda-ignore */
  ignoredLines: Set<string>;
}

/**
 * Configuration for CEDA execution
 */

export interface CedaConfig {
  /** GitHub token for API access */
  githubToken: string;

  /** LLM API key (Anthropic or OpenAI) */
  llmApiKey: string;

  /** LLM provider choice */
  llmProvider: 'anthropic' | 'openai';

  /** Minimum risk score to post a comment (0-100) */
  riskThreshold: number;

  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Helper function to validate LLM JSON output
 */

export function validateAuditResult(data: unknown): CedaAuditResult {
  return CedaAuditResultSchema.parse(data);
}

/**
 * Helper function to safely parse LLM JSON with error handling
 */

export function safeParseAuditResult(data: unknown):
  | {
      success: true;
      data: CedaAuditResult;
    }
  | {
      success: false;
      error: string;
    } {
  try {
    const result = CedaAuditResultSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
