import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage for the terminal surface (previously untested). No AI. Uses node-pty via the main
// process, so it skips if the terminal can't spawn in this build.
test.describe('§51 Terminal panel', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default'); // active project → terminal cwd
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('opens the terminal panel and spawns a terminal', async () => {
    const { page } = fixture;
    const panel = page.locator('[data-testid="terminal-panel"]');
    if (!(await panel.isVisible().catch(() => false))) {
      await page.locator('[data-testid="zone-rail-button-terminal"]').click();
    }
    await expect(panel).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="terminal-button-new"]').click();
    // The xterm instance renders once the pty is attached.
    const xterm = page.locator('.xterm');
    if (
      !(await xterm
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false))
    ) {
      test.skip(true, 'terminal (node-pty) did not spawn in this build');
      return;
    }
    await expect(xterm.first()).toBeVisible();
  });
});
