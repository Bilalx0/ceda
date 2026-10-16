import { z } from 'zod';
/**
 * Severity levels for detected issues
 * Ordered from most critical to least critical
 */
export declare const SeverityLevelSchema: z.ZodEnum<{
    CRITICAL: "CRITICAL";
    HIGH: "HIGH";
    MEDIUM: "MEDIUM";
    LOW: "LOW";
}>;
export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;
/**
 * Types of issues CEDA can detect
 */
export declare const IssueTypeSchema: z.ZodEnum<{
    HALLUCINATION: "HALLUCINATION";
    SECURITY_LEAK: "SECURITY_LEAK";
    TEST_CHEATING: "TEST_CHEATING";
    LOGIC_BUG: "LOGIC_BUG";
}>;
export type IssueType = z.infer<typeof IssueTypeSchema>;
/**
 * Individual issue detected by CEDA
 */
export declare const CedaIssueSchema: z.ZodObject<{
    file: z.ZodString;
    line: z.ZodOptional<z.ZodNumber>;
    severity: z.ZodEnum<{
        CRITICAL: "CRITICAL";
        HIGH: "HIGH";
        MEDIUM: "MEDIUM";
        LOW: "LOW";
    }>;
    type: z.ZodEnum<{
        HALLUCINATION: "HALLUCINATION";
        SECURITY_LEAK: "SECURITY_LEAK";
        TEST_CHEATING: "TEST_CHEATING";
        LOGIC_BUG: "LOGIC_BUG";
    }>;
    title: z.ZodString;
    description: z.ZodString;
    suggestedFix: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CedaIssue = z.infer<typeof CedaIssueSchema>;
/**
 * Overall audit result from CEDA
 */
export declare const CedaAuditResultSchema: z.ZodObject<{
    overallRisk: z.ZodEnum<{
        PASS: "PASS";
        WARNING: "WARNING";
        BLOCK: "BLOCK";
    }>;
    riskScore: z.ZodNumber;
    summary: z.ZodString;
    issues: z.ZodDefault<z.ZodArray<z.ZodObject<{
        file: z.ZodString;
        line: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodEnum<{
            CRITICAL: "CRITICAL";
            HIGH: "HIGH";
            MEDIUM: "MEDIUM";
            LOW: "LOW";
        }>;
        type: z.ZodEnum<{
            HALLUCINATION: "HALLUCINATION";
            SECURITY_LEAK: "SECURITY_LEAK";
            TEST_CHEATING: "TEST_CHEATING";
            LOGIC_BUG: "LOGIC_BUG";
        }>;
        title: z.ZodString;
        description: z.ZodString;
        suggestedFix: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    testFileModified: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
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
export declare function validateAuditResult(data: unknown): CedaAuditResult;
/**
 * Helper function to safely parse LLM JSON with error handling
 */
export declare function safeParseAuditResult(data: unknown): {
    success: true;
    data: CedaAuditResult;
} | {
    success: false;
    error: string;
};
//# sourceMappingURL=ceda.d.ts.map