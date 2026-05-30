import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { openZone } from '../helpers/zones.js';

// New coverage from scenarios/files-editor-review.md (F8 inline comment, F9 center save). F8 sends
// the comment as a chat message (uses AI; yolo avoids a stuck permission card); F9 is no-AI.
test.describe('§53 Editor — comments & save', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'yolo');
    await openZone(fixture.page, 'zone-rail-button-files', 'files-root-toggle');
    await fixture.page.locator('[data-testid="files-tree-node-index.ts"]').click();
    await fixture.page.locator('.monaco-editor').first().waitFor({ timeout: 15_000 });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('F8: an inline comment is sent to the chat as a message', async () => {
    const { page } = fixture;
    const editor = page.locator('.monaco-editor').first();
    await editor.locator('.view-line').first().hover();
    await page.locator('.mf-line-comment-glyph').first().click();
    await page.locator('[data-testid="editor-inline-comment-input"]').fill('Please refactor this line');
    await page.locator('[data-testid="editor-inline-comment-send"]').click();
    // The comment is sent as a chat message (File: <path> … <comment>) — it appears in the thread.
    await expect(page.getByText('Please refactor this line').first()).toBeVisible({ timeout: 15_000 });
  });

  test('F9: editing the file shows the save button, and saving clears it', async () => {
    const { page } = fixture;
    await page.locator('.monaco-editor').first().locator('.view-line').first().click();
    await page.keyboard.type('// e2e edit\n');
    const save = page.locator('[data-testid="center-button-save"]');
    await expect(save).toBeVisible({ timeout: 5_000 });
    await save.click();
    await expect(save).toHaveCount(0, { timeout: 10_000 });
  });
});
