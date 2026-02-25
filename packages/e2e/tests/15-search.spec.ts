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

  test('Cmd+F opens the search palette', async () => {
    await fixture.page.keyboard.press('Meta+f');
    await expect(fixture.page.getByRole('dialog')).toBeVisible();
  });

  test('typing finds matching files', async () => {
    await fixture.page.keyboard.type('index');
    await expect(fixture.page.getByText('index.ts')).toBeVisible();
  });

  test('Escape closes the palette', async () => {
    await fixture.page.keyboard.press('Escape');
    await expect(fixture.page.getByRole('dialog')).toHaveCount(0);
  });

  test('Enter on a file result opens it in the editor', async () => {
    await fixture.page.keyboard.press('Meta+f');
    // Wait for the search input to be ready before typing — without this the
    // initial characters are lost while the dialog's focus useEffect fires.
    const searchInput = fixture.page.getByRole('dialog').getByRole('textbox');
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.fill('utils');
    // Wait for file results to appear (300ms debounce + network)
    await expect(fixture.page.getByText('utils.ts')).toBeVisible({ timeout: 5_000 });
    await fixture.page.keyboard.press('ArrowDown');
    await fixture.page.keyboard.press('Enter');
    await expect(fixture.page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 });
  });
});
