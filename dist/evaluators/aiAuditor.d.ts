import { type CedaAuditResult, type LLMContext } from '../types/ceda.js';
interface AIAuditorConfig {
    provider: 'anthropic' | 'openai';
    apiKey: string;
    model?: string;
    maxTokens?: number;
}
export declare function auditWithAI(diff: string, context: LLMContext, modifiedFiles: string[], config: AIAuditorConfig): Promise<CedaAuditResult>;
export declare function createFailOpenResult(reason: string): CedaAuditResult;
export {};
//# sourceMappingURL=aiAuditor.d.ts.map