// Runs the capture "spec" with packages/e2e's Playwright, harness and global setup. See README.md.
import { defineConfig } from '../../../packages/e2e/node_modules/@playwright/test/index.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.mts',
  globalSetup: '../../../packages/e2e/fixtures/global-setup.ts',
  outputDir: '.work/results',
  workers: 1,
  timeout: 600_000,
  reporter: 'line',
});
