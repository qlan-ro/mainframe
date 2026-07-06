import { defineConfig, devices } from '@playwright/experimental-ct-react';
import react from '@vitejs/plugin-react';

export default defineConfig({
  testDir: './src/__tests__/playwright',
  testMatch: '**/*.ct.test.tsx',
  snapshotDir: './__snapshots__',
  timeout: 10_000,
  fullyParallel: true,
  use: {
    ctPort: 3100,
    ctViteConfig: {
      plugins: [react()],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
