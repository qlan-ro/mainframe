import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';

test.describe('§14 Editor & line comments', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await fixture.page.keyboard.press('Meta+n');
    await fixture.page.getByRole('tab', { name: /files/i }).click();
    await fixture.page.getByText('index.ts').click();
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('Monaco editor renders with syntax highlighting for .ts file', async () => {
    await expect(fixture.page.locator('.monaco-editor')).toBeVisible();
    await expect(fixture.page.locator('.mtk')).toBeVisible();
  });

  test('Cmd+Click on a line opens the line comment popover', async () => {
    const editor = fixture.page.locator('.monaco-editor');
    const firstLine = editor.locator('.view-line').first();
    await firstLine.click({ modifiers: ['Meta'] });
    await expect(fixture.page.locator('[data-testid="line-comment-popover"]')).toBeVisible();
  });
});
