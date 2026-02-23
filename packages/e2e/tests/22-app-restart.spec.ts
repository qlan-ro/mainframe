import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { chat } from '../helpers/wait.js';

test.describe('§22 App restart & state persistence', () => {
  test('chat list and thread survive a full app restart', async () => {
    const fixture = await launchApp();
    const project = await createTestProject(fixture.page);
    await fixture.page.keyboard.press('Meta+n');
    await chat(fixture.page, 'Reply only: PERSISTENCE_CHECK', 60_000);

    // Save the data dir path before closing so the second launch uses the same DB
    const { testDataDir } = fixture;
    await fixture.app.close(); // don't call closeApp — that deletes testDataDir

    // Re-launch with the same data directory
    const { _electron: electron } = await import('@playwright/test');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
    const APP_MAIN = path.default.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

    const app2 = await electron.launch({
      args: [APP_MAIN],
      env: { ...process.env, MAINFRAME_DATA_DIR: testDataDir },
    });
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.locator('[data-testid="connection-status"]').waitFor({ timeout: 15_000 });

    try {
      await expect(page2.locator('[data-testid="chat-list-item"]').first()).toBeVisible();
      await page2.locator('[data-testid="chat-list-item"]').first().click();
      await expect(page2.getByText('PERSISTENCE_CHECK')).toBeVisible();
    } finally {
      await app2.close();
      await cleanupProject(project);
      const { rmSync } = await import('fs');
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});
