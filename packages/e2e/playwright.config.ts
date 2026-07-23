import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Builds the UI bundle once and starts the shared vite preview (a stateless static server) for
  // the whole run; returns a teardown that kills it. See fixtures/global-setup.ts.
  globalSetup: './fixtures/global-setup.ts',
  timeout: 120_000, // 2 min per test — AI calls are slow
  // 40 min total by default — the full AI suite (serial) exceeds 10 min end-to-end. Override via
  // MF_E2E_GLOBAL_TIMEOUT (ms) for targeted multi-file invocations where 40 min would starve later
  // files sharing this one process budget (e.g. running a handful of specs back-to-back).
  globalTimeout: process.env['MF_E2E_GLOBAL_TIMEOUT'] ? Number(process.env['MF_E2E_GLOBAL_TIMEOUT']) : 2_400_000,
  workers: 1, // serial — app is stateful
  // One retry: AI responses are non-deterministic (e.g. the agent may not re-issue an identical
  // tool call), so a passing assertion can occasionally flake. Retry runs only on failure, so the
  // extra API cost is incurred rarely.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // Chromium is launched per-suite in beforeAll, not via browser config
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'tauri', testDir: './tests-tauri' }],
});
