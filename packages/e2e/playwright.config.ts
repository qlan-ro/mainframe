import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000, // 2 min per test — AI calls are slow
  globalTimeout: 600_000, // 10 min total run
  workers: 1, // serial — app is stateful
  retries: 0, // no retries — API calls cost money
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // Electron is launched per-suite in beforeAll, not via browser config
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
