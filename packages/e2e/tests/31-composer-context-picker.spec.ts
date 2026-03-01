import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat } from '../helpers/wait.js';

test.describe('§31 Composer context picker', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
    // Boot CLI so it registers commands/skills
    await chat(fixture.page, 'Reply with just the word "ready".');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('typing / opens picker with commands', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    // Claude CLI registers /compact and /clear
    const anyCommand = page.locator('[data-testid^="picker-item-command-"]').first();
    await expect(anyCommand).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
  });

  test('selecting a command inserts it into composer', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const firstCommand = page.locator('[data-testid^="picker-item-command-"]').first();
    await expect(firstCommand).toBeVisible({ timeout: 5_000 });
    await firstCommand.dispatchEvent('mousedown');

    // Composer should contain /<commandName> with trailing space
    await expect(composer).toHaveValue(/^\/\w+ $/, { timeout: 3_000 });

    // Clear for next test
    await composer.fill('');
  });

  test('typing @ with query opens picker with file results', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('@index');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const fileItem = page.locator('[data-testid^="picker-item-file-"]').first();
    await expect(fileItem).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await composer.fill('');
  });

  test('selecting a file inserts @mention into composer', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('@index');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const fileItem = page.locator('[data-testid^="picker-item-file-"]').first();
    await expect(fileItem).toBeVisible({ timeout: 5_000 });
    await fileItem.dispatchEvent('mousedown');

    // Composer should now have @<filepath> with trailing space
    await expect(composer).toHaveValue(/@\S+ $/, { timeout: 3_000 });

    await composer.fill('');
  });

  test('Escape closes the picker', async () => {
    const { page } = fixture;
    const composer = page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(picker).not.toBeVisible({ timeout: 3_000 });
  });

  test('sending message with @mention references the file', async () => {
    // fill() sets text instantly — the @ is at position 0 but text continues with
    // non-@ words, so the picker regex (?:^|\s)@(\S*)$ won't match (last word
    // isn't @-prefixed). Enter sends the message, not picks an item.
    await chat(fixture.page, '@CLAUDE.md summarize this file in one sentence. Start reply with "Summary:"', 60_000);

    await expect(fixture.page.getByText('Summary:', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });
});
