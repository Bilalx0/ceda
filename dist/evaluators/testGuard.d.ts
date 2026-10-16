import type { CedaIssue } from '../types/ceda.js';
/**
 * Evaluates if a PR is attempting "test cheating" by modifying
 * both application source code and test files simultaneously.
 *
 * @param modifiedFiles - Array of file paths changed in the PR
 * @returns Array of CedaIssue objects if test cheating is detected
 */
export declare function evaluateTestCheating(modifiedFiles: string[]): CedaIssue[];
//# sourceMappingURL=testGuard.d.ts.map