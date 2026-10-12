import * as core from '@actions/core';
import type { CedaIssue, SeverityLevel } from '../types/ceda.js';

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: SeverityLevel;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'CRITICAL',
  },
  {
    name: 'GitHub Token',
    pattern: /ghp_[0-9a-zA-Z]{36}/,
    severity: 'CRITICAL',
  },
  {
    name: 'Generic API Key',
    pattern: /(api[_-]?key|apikey)\s*[:=]\s*['"][0-9a-zA-Z]{32,}['"]/i,
    severity: 'HIGH',
  },
  {
    name: 'Generic Secret',
    pattern: /(secret|password|passwd|pwd)\s*[:=]\s*['"][^\s'"]{8,}['"]/i,
    severity: 'HIGH',
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: 'CRITICAL',
  },
  {
    name: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/,
    severity: 'HIGH',
  },
  {
    name: 'Database Connection String',
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^@\s]+@[^@\s]+/i,
    severity: 'CRITICAL',
  },
];

export function detectSecrets(diffContent: string, filePath: string): CedaIssue[] {
  const issues: CedaIssue[] = [];

  if (filePath.includes('.env.example') || filePath.includes('README')) {
    return issues;
  }

  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    const matches = diffContent.match(pattern);

    if (matches) {
      issues.push({
        file: filePath,
        severity,
        type: 'SECURITY_LEAK',
        title: `Potential ${name} Detected`,
        description:
          `Hardcoded ${name.toLowerCase()} found in code. ` +
          'This is a critical security risk. Secrets should never be committed to version control. ' +
          'Use environment variables or a secrets manager instead.',
        suggestedFix: `Remove the ${name.toLowerCase()} and use environment variables.`,
      });

      core.error(`CEDA Secret Detector: Found ${name} in ${filePath}`);
    }
  }

  if (issues.length === 0) {
    core.info(`CEDA Secret Detector: No secrets detected in ${filePath}`);
  }

  return issues;
}
