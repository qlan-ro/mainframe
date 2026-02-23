import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { sendMessage, waitForAIIdle } from '../helpers/wait.js';

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
    await fixture.page.keyboard.press('Meta+n');
    await sendMessage(fixture.page, 'Reply only: CHAT_A_RESPONSE');

    await fixture.page.keyboard.press('Meta+n');
    await sendMessage(fixture.page, 'Reply only: CHAT_B_RESPONSE');

    const chats = fixture.page.locator('[data-testid="chat-list-item"]');
    await chats.nth(0).click();
    await waitForAIIdle(fixture.page, 90_000);
    await expect(fixture.page.getByText('CHAT_A_RESPONSE')).toBeVisible();

    await chats.nth(1).click();
    await waitForAIIdle(fixture.page, 90_000);
    await expect(fixture.page.getByText('CHAT_B_RESPONSE')).toBeVisible();

    await expect(fixture.page.getByText('CHAT_A_RESPONSE')).toHaveCount(0);
  });
});
