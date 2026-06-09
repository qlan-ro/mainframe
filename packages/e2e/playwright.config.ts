import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120_000, // 2 min per test — AI calls are slow
  globalTimeout: 2_400_000, // 40 min total — the full AI suite (serial) exceeds 10 min end-to-end
  workers: 1, // serial — app is stateful
  // One retry: AI responses are non-deterministic (e.g. the agent may not re-issue an identical
  // tool call), so a passing assertion can occasionally flake. Retry runs only on failure, so the
  // extra API cost is incurred rarely.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // Electron/Chromium are launched per-suite in beforeAll, not via browser config
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Two suites: the legacy Electron desktop harness (tests/) and the new app-tauri
  // browser-mode harness (tests-tauri/). They share the daemon plumbing but launch
  // different UIs, so they live in separate projects with isolated testDirs.
  projects: [
    { name: 'electron', testDir: './tests' },
    { name: 'tauri', testDir: './tests-tauri' },
  ],
});
