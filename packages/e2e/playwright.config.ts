import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000, // 2 min per test — AI calls are slow
  globalTimeout: 2_400_000, // 40 min total — the full AI suite (serial) exceeds 10 min end-to-end
  workers: 1, // serial — app is stateful
  // One retry: AI responses are non-deterministic (e.g. the agent may not re-issue an identical
  // tool call), so a passing assertion can occasionally flake. Retry runs only on failure, so the
  // extra API cost is incurred rarely.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // Electron is launched per-suite in beforeAll, not via browser config
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
