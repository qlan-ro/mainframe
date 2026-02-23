import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { chat } from '../helpers/wait.js';

test.describe('§12–13 Changes tab & diff viewer', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await fixture.page.keyboard.press('Meta+n');
    await chat(fixture.page, 'Edit index.ts and add a comment "// changed by AI" on line 1', 90_000);
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('Session mode shows AI-modified files', async () => {
    await fixture.page.getByRole('tab', { name: /changes/i }).click();
    await fixture.page.getByRole('button', { name: /session/i }).click();
    await expect(fixture.page.getByText('index.ts')).toBeVisible();
  });

  test('Branch mode shows git-tracked changes', async () => {
    await fixture.page.getByRole('button', { name: /branch/i }).click();
    await expect(fixture.page.getByText('index.ts')).toBeVisible();
  });

  test('clicking a changed file opens the diff viewer', async () => {
    await fixture.page.getByText('index.ts').click();
    await expect(fixture.page.locator('.monaco-diff-editor')).toBeVisible();
  });
});
