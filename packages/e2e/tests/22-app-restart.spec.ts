import { test, expect } from '@playwright/test';
import { launchApp, E2E_ELECTRON_EXTRA_ARGS } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

test.describe('§22 App restart & state persistence', () => {
  test('chat list and thread survive a full app restart', async () => {
    const fixture = await launchApp({ recordingKey: 'app-restart' });
    const project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'yolo');
    await chat(fixture.page, 'Reply only: PERSISTENCE_CHECK', 60_000);

    // Save the data dir path before closing so the second launch uses the same DB
    const { testDataDir } = fixture;
    // Close only the Electron window — keep the daemon running so the second
    // launch can reconnect to it immediately without waiting for startup.
    await fixture.app.close();

    // Re-launch with the same data directory and in development mode so Electron
    // skips its own daemon startup (the test daemon is still running).
    const { _electron: electron } = await import('@playwright/test');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
    const APP_MAIN = path.default.resolve(__dirname, '../../../packages/app-electron/out/main/index.js');

    const app2 = await electron.launch({
      // Reuse the SAME Chromium profile launchApp() created, so localStorage (active chat, layout)
      // persists across the restart — otherwise the relaunch gets a fresh default profile.
      args: [
        APP_MAIN,
        ...E2E_ELECTRON_EXTRA_ARGS,
        `--user-data-dir=${path.default.join(testDataDir, 'electron-profile')}`,
      ],
      env: { ...process.env, NODE_ENV: 'development', MAINFRAME_DATA_DIR: testDataDir, MF_E2E: '1' },
    });
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });

    try {
      await expect(page2.locator('[data-testid="chat-list-item"]').first()).toBeVisible();
      await page2.locator('[data-testid="chat-list-item"]').first().click();
      await expect(page2.getByText('PERSISTENCE_CHECK', { exact: true })).toBeVisible();
    } finally {
      await app2.close();
      fixture.daemon.kill();
      await cleanupProject(project);
      const { rmSync } = await import('fs');
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});
