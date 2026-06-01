import { test, expect } from '@playwright/test';
import { skipUnrecordedInMock } from '../helpers/mock-skip.js';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';
import { openZone, setChangesMode } from '../helpers/zones.js';

test.beforeEach(skipUnrecordedInMock);

test.describe('§10–11 Context & Files tabs', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // Use acceptEdits so Claude edits files directly without entering plan mode
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('modified file appears in Changes tab after AI edits it', async () => {
    await chat(fixture.page, 'Edit index.ts and add a comment at the top', 90_000);
    await openZone(fixture.page, 'zone-rail-button-changes', 'zone-button-tab-dropdown');
    await setChangesMode(fixture.page, 'session');
    await fixture.page.locator('[data-testid="changes-refresh"]').click();
    await expect(fixture.page.locator('[data-testid^="changes-session-file-"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('files tab shows project file tree', async () => {
    await openZone(fixture.page, 'zone-rail-button-files', 'files-root-toggle');
    await expect(fixture.page.locator('[data-testid="files-tree-node-index.ts"]')).toBeVisible({ timeout: 10_000 });
    await expect(fixture.page.locator('[data-testid="files-tree-node-utils.ts"]')).toBeVisible();
  });

  test('clicking a file in the files tab opens the editor', async () => {
    await openZone(fixture.page, 'zone-rail-button-files', 'files-root-toggle');
    await fixture.page.locator('[data-testid="files-tree-node-index.ts"]').click();
    await expect(fixture.page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 });
  });

  test('F12: review-changes modal opens and closes', async () => {
    const { page } = fixture;
    // The AI edit above left session changes for this chat to review.
    await page.locator('[data-testid="chat-review-changes-button"]').click();
    await expect(page.locator('[data-testid="review-modal"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="review-button-close"]').click();
    await expect(page.locator('[data-testid="review-modal"]')).toHaveCount(0, { timeout: 5_000 });
  });
});
