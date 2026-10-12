import * as core from '@actions/core';

async function run(): Promise<void> {
  try {
    core.info('🚀 CEDA Auditor initialized.');

    // We will build out the pipeline here in the next steps
    const token = core.getInput('github-token', { required: true });
    core.info(`✅ GitHub token found (length: ${token.length})`);

    core.info('✅ CEDA run completed successfully.');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`❌ CEDA Auditor failed: ${errorMessage}`);
  }
}

run();
