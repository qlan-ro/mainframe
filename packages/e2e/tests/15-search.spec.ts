import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

test.describe('§15 Search palette', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // Need an active chat so the project context (for file search) is set
    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  // The global search palette is Cmd+O now (Cmd+F is find-in-thread).
  test('Cmd+O opens the search palette', async () => {
    await fixture.page.keyboard.press('Meta+o');
    await expect(fixture.page.locator('[data-testid="search-palette-dialog"]')).toBeVisible();
  });

  test('typing finds matching files', async () => {
    await fixture.page.locator('[data-testid="search-palette-input"]').fill('index');
    await expect(fixture.page.getByText('index.ts')).toBeVisible({ timeout: 5_000 });
  });

  test('Escape closes the palette', async () => {
    await fixture.page.keyboard.press('Escape');
    await expect(fixture.page.locator('[data-testid="search-palette-dialog"]')).toHaveCount(0);
  });

  test('clicking a file result opens it in the editor', async () => {
    await fixture.page.keyboard.press('Meta+o');
    const searchInput = fixture.page.locator('[data-testid="search-palette-input"]');
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.fill('utils');
    // Wait for file results (300ms debounce + network). Click the file result directly — the
    // palette lists sessions first, so ArrowDown+Enter would select a session, not the file.
    const fileResult = fixture.page.locator('[data-testid^="search-palette-file-"]').first();
    await fileResult.waitFor({ timeout: 5_000 });
    await fileResult.click();
    await expect(fixture.page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 });
  });
});
