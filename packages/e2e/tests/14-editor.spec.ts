import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { openZone } from '../helpers/zones.js';

test.describe('§14 Editor & line comments', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // A chat establishes the active project (the Files tab is project-scoped via the active chat).
    await createTestChat(fixture.page, project.projectId, 'default');
    await openZone(fixture.page, 'zone-rail-button-files', 'files-root-toggle');
    await fixture.page.locator('[data-testid="files-tree-node-index.ts"]').click();
    // Wait for Monaco to mount before tests start
    await fixture.page.locator('.monaco-editor').first().waitFor({ timeout: 15_000 });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('Monaco editor renders with syntax highlighting for .ts file', async () => {
    await expect(fixture.page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 });
    await expect(fixture.page.locator('[class*="mtk"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test('glyph-margin click opens the inline line-comment widget', async () => {
    // The line-comment popover was replaced by an inline Monaco view-zone widget. Hovering a line
    // reveals the glyph-margin icon; clicking it opens editor-inline-comment-input.
    const editor = fixture.page.locator('.monaco-editor').first();
    await editor.locator('.view-line').first().hover();
    await fixture.page.locator('.mf-line-comment-glyph').first().click();
    await expect(fixture.page.locator('[data-testid="editor-inline-comment-input"]')).toBeVisible({
      timeout: 10_000,
    });
  });
});
