import * as core from '@actions/core';
import type { CedaIssue, SeverityLevel } from '../types/ceda.js';

/**
 * Common test file extensions and patterns to monitor
 */
const TEST_FILE_PATTERNS = [
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.spec.js',
  '_test.py',
  '_spec.py',
  '.test.tsx',
  '.spec.tsx',
];

/**
 * Evaluates if a PR is attempting "test cheating" by modifying
 * both application source code and test files simultaneously.
 *
 * @param modifiedFiles - Array of file paths changed in the PR
 * @returns Array of CedaIssue objects if test cheating is detected
 */
export function evaluateTestCheating(modifiedFiles: string[]): CedaIssue[] {
  const issues: CedaIssue[] = [];

  let hasSourceModification = false;
  let hasTestModification = false;
  const modifiedTestFiles: string[] = [];

  for (const file of modifiedFiles) {
    const isTestFile = TEST_FILE_PATTERNS.some((pattern) => file.endsWith(pattern));

    if (isTestFile) {
      hasTestModification = true;
      modifiedTestFiles.push(file);
    } else {
      // Assume anything else is source code, config, or docs
      // We specifically care if there's AT LEAST one non-test file
      hasSourceModification = true;
    }
  }

  // The core heuristic: Did they change source AND tests in the same PR?
  if (hasSourceModification && hasTestModification) {
    const severity: SeverityLevel = 'HIGH';

    issues.push({
      file: 'MULTIPLE',
      severity,
      type: 'TEST_CHEATING',
      title: 'Simultaneous Source and Test Modification Detected',
      description:
        `This PR modifies both application code and test files (${modifiedTestFiles.join(', ')}). ` +
        'AI models frequently alter tests to force broken implementations to pass. ' +
        'Please ensure test changes are strictly for legitimate refactoring or new feature coverage, ' +
        'and manually verify the test assertions are valid.',
      suggestedFix:
        'Consider splitting this PR: one for the feature implementation, and a separate PR for test updates if absolutely necessary.',
    });

    core.warning(`CEDA Test Guard: Detected simultaneous source and test modifications.`);
  } else {
    core.info('CEDA Test Guard: No test cheating patterns detected.');
  }

  return issues;
}
