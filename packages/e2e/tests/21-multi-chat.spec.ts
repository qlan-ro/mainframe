import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

test.describe('§21 Multiple simultaneous chats', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('two chats complete independently without cross-contamination', async () => {
    // Create Chat A and wait for the response
    await createTestChat(fixture.page, project.projectId, 'default');
    await chat(fixture.page, 'Reply only: CHAT_A_RESPONSE', 90_000);

    // Create Chat B (becomes index 0; Chat A moves to index 1) and wait for response
    await createTestChat(fixture.page, project.projectId, 'default');
    await chat(fixture.page, 'Reply only: CHAT_B_RESPONSE', 90_000);

    const chats = fixture.page.locator('[data-testid="chat-list-item"]');

    // Switch to Chat A (older, index 1) and verify its response
    await chats.nth(1).click();
    await expect(fixture.page.getByText('CHAT_A_RESPONSE')).toBeVisible({ timeout: 5_000 });

    // Switch to Chat B (more recent, index 0) and verify its response
    await chats.nth(0).click();
    await expect(fixture.page.getByText('CHAT_B_RESPONSE')).toBeVisible({ timeout: 5_000 });

    // Cross-contamination check: Chat A's response must not appear in Chat B's view
    await expect(fixture.page.getByText('CHAT_A_RESPONSE')).toHaveCount(0);
  });
});
