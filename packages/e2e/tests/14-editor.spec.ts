import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';

test.describe('§14 Editor & line comments', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // No chat needed — just open index.ts via the Files tab
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByRole('tab', { name: /files/i }).click();
    await panel.getByText('index.ts', { exact: true }).first().click();
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

  test('Cmd+Click on a line opens the line comment popover', async () => {
    const editor = fixture.page.locator('.monaco-editor');
    const firstLine = editor.locator('.view-line').first();
    await firstLine.click({ modifiers: ['Meta'] });
    await expect(fixture.page.locator('[data-testid="line-comment-popover"]')).toBeVisible();
  });
});
