import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat, waitForAIIdle } from '../helpers/wait.js';

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
    await expect(picker).toBeVisible({ timeout: 10_000 });

    // Claude adapter commands should appear
    const compactItem = fixture.page.locator('[data-testid="picker-item-command-compact"]');
    const clearItem = fixture.page.locator('[data-testid="picker-item-command-clear"]');
    await expect(compactItem).toBeVisible({ timeout: 5_000 });
    await expect(clearItem).toBeVisible({ timeout: 5_000 });

    // Close the picker
    await fixture.page.keyboard.press('Escape');
  });

  test('selecting /compact sends command and CLI processes it', async () => {
    const composer = fixture.page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = fixture.page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    // Click the compact command item directly (don't rely on keyboard Enter
    // which selects the first item — that could be a skill, not a command)
    const compactItem = fixture.page.locator('[data-testid="picker-item-command-compact"]');
    await expect(compactItem).toBeVisible({ timeout: 5_000 });
    await compactItem.dispatchEvent('mousedown');

    // Composer should now have "/compact " inserted
    await expect(composer).toHaveValue('/compact ', { timeout: 3_000 });

    // Send it
    await fixture.page.keyboard.press('Enter');

    // Wait for CLI to process — compact triggers system:init re-emission
    await waitForAIIdle(fixture.page, 30_000);

    // The command bubble should render with the command testid
    const commandBubble = fixture.page.locator('[data-testid="user-command-bubble"]').last();
    await expect(commandBubble).toBeVisible({ timeout: 5_000 });
    await expect(commandBubble).toContainText('/compact');
  });

  test('/clear command resets conversation', async () => {
    // First send a normal message so there's history
    await chat(fixture.page, 'What is 1 + 1? Reply with just the number.');
    await expect(fixture.page.getByText('2', { exact: true }).first()).toBeVisible();

    // Now send /clear by clicking it from the picker
    const composer = fixture.page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = fixture.page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const clearItem = fixture.page.locator('[data-testid="picker-item-command-clear"]');
    await expect(clearItem).toBeVisible({ timeout: 5_000 });
    await clearItem.dispatchEvent('mousedown');

    await expect(composer).toHaveValue('/clear ', { timeout: 3_000 });
    await fixture.page.keyboard.press('Enter');

    await waitForAIIdle(fixture.page, 30_000);

    // The clear command should appear as a command bubble
    const commandBubble = fixture.page.locator('[data-testid="user-command-bubble"]').last();
    await expect(commandBubble).toBeVisible({ timeout: 5_000 });
    await expect(commandBubble).toContainText('/clear');
  });
});
