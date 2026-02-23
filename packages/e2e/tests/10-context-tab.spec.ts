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

  test('modified file appears in Context tab after AI edits it', async () => {
    await chat(fixture.page, 'Edit index.ts and add a comment at the top', 90_000);
    await fixture.page.getByRole('tab', { name: /context/i }).click();
    await expect(fixture.page.getByText('index.ts')).toBeVisible();
  });

  test('files tab shows project file tree', async () => {
    await fixture.page.getByRole('tab', { name: /files/i }).click();
    await expect(fixture.page.getByText('index.ts')).toBeVisible();
    await expect(fixture.page.getByText('utils.ts')).toBeVisible();
  });

  test('clicking a file in the files tab opens the editor', async () => {
    await fixture.page.getByRole('tab', { name: /files/i }).click();
    await fixture.page.getByText('index.ts').click();
    await expect(fixture.page.locator('.monaco-editor')).toBeVisible();
  });
});
