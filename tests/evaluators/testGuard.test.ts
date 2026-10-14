import { describe, it, expect } from 'vitest';
import { evaluateTestCheating } from '../../src/evaluators/testGuard.js';

describe('evaluateTestCheating', () => {
  it('should return empty array when only source files are modified', () => {
    const files = ['src/index.ts', 'src/utils/api.ts', 'README.md'];
    const issues = evaluateTestCheating(files);
    expect(issues).toHaveLength(0);
  });

  it('should return empty array when only test files are modified', () => {
    const files = ['src/index.test.ts', 'src/utils/api.spec.ts'];
    const issues = evaluateTestCheating(files);
    expect(issues).toHaveLength(0);
  });

  it('should detect test cheating when both source and test files are modified', () => {
    const files = ['src/index.ts', 'src/index.test.ts', 'src/utils/api.ts'];
    const issues = evaluateTestCheating(files);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('TEST_CHEATING');
    expect(issues[0].severity).toBe('HIGH');
    expect(issues[0].title).toContain('Simultaneous');
  });

  it('should detect various test file patterns', () => {
    const files = ['src/auth.ts', 'tests/auth.spec.ts'];
    const issues = evaluateTestCheating(files);
    expect(issues).toHaveLength(1);
  });

  it('should handle empty file list', () => {
    const issues = evaluateTestCheating([]);
    expect(issues).toHaveLength(0);
  });

  it('should include test file names in description', () => {
    const files = ['src/user.ts', 'src/user.test.ts', 'src/user.spec.ts'];
    const issues = evaluateTestCheating(files);

    expect(issues[0].description).toContain('user.test.ts');
    expect(issues[0].description).toContain('user.spec.ts');
  });
});
