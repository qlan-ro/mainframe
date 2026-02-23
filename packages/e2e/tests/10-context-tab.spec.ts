import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

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
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByRole('tab', { name: /changes/i }).click();
    await expect(panel.getByText('index.ts', { exact: true }).first()).toBeVisible();
  });

  test('files tab shows project file tree', async () => {
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByRole('tab', { name: /files/i }).click();
    await expect(panel.getByText('index.ts', { exact: true }).first()).toBeVisible();
    await expect(panel.getByText('utils.ts', { exact: true }).first()).toBeVisible();
  });

  test('clicking a file in the files tab opens the editor', async () => {
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByRole('tab', { name: /files/i }).click();
    await panel.getByText('index.ts', { exact: true }).first().click();
    await expect(fixture.page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 });
  });
});
