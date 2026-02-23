import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

test.describe('§5 Messaging & AI responses', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('sends a message and receives a response', async () => {
    await chat(fixture.page, 'What is 2 + 2? Reply with just the number.');
    await expect(fixture.page.getByText('4', { exact: true }).first()).toBeVisible();
  });

  test('turn footer shows token count after response', async () => {
    await expect(fixture.page.locator('[data-testid="turn-footer"]').first()).toBeVisible();
  });

  test('AI can invoke a tool to list files', async () => {
    await chat(fixture.page, 'List the files in this project using bash ls.', 90_000);
    await expect(fixture.page.locator('[data-testid="tool-card"]').first()).toBeVisible();
  });
});
