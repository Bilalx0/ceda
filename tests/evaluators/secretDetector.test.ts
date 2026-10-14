import { describe, it, expect } from 'vitest';
import { detectSecrets } from '../../src/evaluators/secretDetector.js';

describe('detectSecrets', () => {
  it('should detect AWS access key', () => {
    const diff = '+const key = "AKIAIOSFODNN7EXAMPLE";';
    const issues = detectSecrets(diff, 'src/config.ts');

    expect(issues.some((i) => i.title.includes('AWS Access Key'))).toBe(true);
  });

  it('should detect GitHub token', () => {
    const diff = '+const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";';
    const issues = detectSecrets(diff, 'src/auth.ts');

    expect(issues.some((i) => i.title.includes('GitHub Token'))).toBe(true);
  });

  it('should detect private key', () => {
    const diff = '+-----BEGIN RSA PRIVATE KEY-----\n+MIIEow...';
    const issues = detectSecrets(diff, 'src/keys.ts');

    expect(issues.some((i) => i.title.includes('Private Key'))).toBe(true);
  });

  it('should detect database connection string', () => {
    const diff = '+const db = "mongodb://user:pass@localhost:27017/mydb";';
    const issues = detectSecrets(diff, 'src/db.ts');

    expect(issues.some((i) => i.title.includes('Database Connection'))).toBe(true);
  });

  it('should skip .env.example files', () => {
    const diff = '+API_KEY=sk_test_123456';
    const issues = detectSecrets(diff, '.env.example');

    expect(issues).toHaveLength(0);
  });

  it('should skip README files', () => {
    const diff = '+const key = "AKIAIOSFODNN7EXAMPLE";';
    const issues = detectSecrets(diff, 'README.md');

    expect(issues).toHaveLength(0);
  });

  it('should return empty array for clean code', () => {
    const diff = '+const name = "John";\n+console.log(name);';
    const issues = detectSecrets(diff, 'src/index.ts');

    expect(issues).toHaveLength(0);
  });

  it('should set correct severity for critical secrets', () => {
    const diff = '+const key = "AKIAIOSFODNN7EXAMPLE";';
    const issues = detectSecrets(diff, 'src/config.ts');

    const awsIssue = issues.find((i) => i.title.includes('AWS'));
    expect(awsIssue?.severity).toBe('CRITICAL');
  });
});
