import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat, sendMessage, waitForAIIdle } from '../helpers/wait.js';

test.describe('§27 Custom commands', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
    // Send an initial message so the CLI session is fully initialized
    await chat(fixture.page, 'Reply with just the word "ready".');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('typing / opens the context picker with commands', async () => {
    const composer = fixture.page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = fixture.page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // Claude adapter commands should appear
    const compactItem = fixture.page.locator('[data-testid="picker-item-command-compact"]');
    const clearItem = fixture.page.locator('[data-testid="picker-item-command-clear"]');
    await expect(compactItem).toBeVisible();
    await expect(clearItem).toBeVisible();

    // Close the picker
    await fixture.page.keyboard.press('Escape');
  });

  test('selecting /compact sends command and CLI processes it', async () => {
    const composer = fixture.page.getByRole('textbox');
    await composer.click();
    await composer.fill('/compact');

    const picker = fixture.page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    const compactItem = fixture.page.locator('[data-testid="picker-item-command-compact"]');
    await expect(compactItem).toBeVisible();

    // Select the command via Enter (it should be the first/selected item)
    await fixture.page.keyboard.press('Enter');

    // Composer should now have "/compact " inserted
    await expect(composer).toHaveValue('/compact ');

    // Send it
    await fixture.page.keyboard.press('Enter');

    // Wait for CLI to process — compact triggers system:init re-emission
    await waitForAIIdle(fixture.page, 30_000);

    // The command bubble should render with the command testid
    const commandBubble = fixture.page.locator('[data-testid="user-command-bubble"]').last();
    await expect(commandBubble).toBeVisible();
    await expect(commandBubble).toContainText('/compact');
  });

  test('/clear command resets conversation', async () => {
    // First send a normal message so there's history
    await chat(fixture.page, 'What is 1 + 1? Reply with just the number.');
    await expect(fixture.page.getByText('2', { exact: true }).first()).toBeVisible();

    // Now send /clear
    const composer = fixture.page.getByRole('textbox');
    await composer.click();
    await composer.fill('/clear');

    const picker = fixture.page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    await fixture.page.keyboard.press('Enter');
    await expect(composer).toHaveValue('/clear ');
    await fixture.page.keyboard.press('Enter');

    await waitForAIIdle(fixture.page, 30_000);

    // The clear command should appear as a command bubble
    const commandBubble = fixture.page.locator('[data-testid="user-command-bubble"]').last();
    await expect(commandBubble).toBeVisible();
    await expect(commandBubble).toContainText('/clear');
  });
});
