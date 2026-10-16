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
export declare function fetchAndParseDiff(octokit: Octokit, owner: string, repo: string, pullNumber: number): Promise<ParsedDiff>;
export declare function shouldSkipFile(filename: string): boolean;
export declare function filterRelevantFiles(diff: ParsedDiff): ParsedDiff;
export declare function getFullDiffContent(diff: ParsedDiff): string;
export {};
//# sourceMappingURL=diffParser.d.ts.map