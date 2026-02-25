import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

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
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByRole('tab', { name: /changes/i }).click();
    await panel.getByRole('button', { name: /session/i }).click();
    await expect(panel.getByText('index.ts', { exact: true }).first()).toBeVisible();
  });

  test('Branch mode shows git-tracked changes', async () => {
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByRole('button', { name: /branch/i }).click();
    await expect(panel.getByText('index.ts', { exact: true }).first()).toBeVisible();
  });

  test('clicking a changed file opens the diff viewer', async () => {
    const panel = fixture.page.locator('[data-testid="right-panel"]');
    await panel.getByText('index.ts', { exact: true }).first().click();
    await expect(fixture.page.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 15_000 });
  });
});
