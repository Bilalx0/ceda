import type { LLMContext } from '../types/ceda.js';
export declare function extractValidDependencies(projectRoot: string): Promise<string[]>;
export declare function extractNewSymbols(fileContent: string, filePath: string): string[];
export declare function extractIgnoredLines(diffContent: string): Set<string>;
export declare function buildLLMContext(projectRoot: string, modifiedFiles: string[], fileContents: Map<string, string>, diffContent: string): Promise<LLMContext>;
//# sourceMappingURL=astParser.d.ts.map