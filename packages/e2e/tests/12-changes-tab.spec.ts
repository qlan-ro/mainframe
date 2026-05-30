import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';
import { openZone, setChangesMode } from '../helpers/zones.js';

test.describe('§12–13 Changes tab & diff viewer', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // Use acceptEdits so Claude edits files directly without entering plan mode
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
    await chat(fixture.page, 'Edit index.ts and add a comment "// changed by AI" on line 1', 90_000);
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('Session mode shows AI-modified files', async () => {
    await openZone(fixture.page, 'zone-rail-button-changes', 'zone-button-tab-dropdown');
    await setChangesMode(fixture.page, 'session');
    // Re-fetch in case the final tool-result persisted just after the AI turn settled.
    await fixture.page.locator('[data-testid="changes-refresh"]').click();
    await expect(fixture.page.locator('[data-testid^="changes-session-file-"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Uncommitted mode shows the git working-tree change', async () => {
    await openZone(fixture.page, 'zone-rail-button-changes', 'zone-button-tab-dropdown');
    await setChangesMode(fixture.page, 'uncommitted');
    await fixture.page.locator('[data-testid="changes-refresh"]').click();
    await expect(fixture.page.locator('[data-testid^="changes-uncommitted-file-"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('clicking a changed file opens the diff viewer', async () => {
    await openZone(fixture.page, 'zone-rail-button-changes', 'zone-button-tab-dropdown');
    await setChangesMode(fixture.page, 'session');
    await fixture.page.locator('[data-testid="changes-refresh"]').click();
    await fixture.page.locator('[data-testid^="changes-session-file-"]').first().click();
    await expect(fixture.page.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 15_000 });
  });
});
