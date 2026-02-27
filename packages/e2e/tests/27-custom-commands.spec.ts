import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat, waitForAIIdle } from '../helpers/wait.js';

/** Read lastContextTokensInput for the first chat via daemon REST API. */
async function getContextTokens(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const base = 'http://127.0.0.1:31415';
    const res = await fetch(`${base}/api/projects`);
    const projects = await res.json();
    const projectId = projects.data?.[0]?.id;
    if (!projectId) return 0;
    const chatsRes = await fetch(`${base}/api/projects/${projectId}/chats`);
    const chats = await chatsRes.json();
    const chatId = chats.data?.[0]?.id;
    if (!chatId) return 0;
    const chatRes = await fetch(`${base}/api/chats/${chatId}`);
    const chatData = await chatRes.json();
    return chatData.data?.lastContextTokensInput ?? 0;
  });
}

/** Send /compact or /clear via the picker. */
async function sendCommandViaPicker(page: Page, commandName: string): Promise<void> {
  const composer = page.getByRole('textbox');
  await composer.click();
  await composer.fill('/');
  const picker = page.locator('[data-testid="context-picker-menu"]');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  const item = page.locator(`[data-testid="picker-item-command-${commandName}"]`);
  await item.dispatchEvent('mousedown');
  await expect(composer).toHaveValue(`/${commandName} `, { timeout: 3_000 });
  await page.keyboard.press('Enter');
  await waitForAIIdle(page, 30_000);
}

// ── Commands are disabled in the adapter (sendCommand doesn't work reliably) ──
// These tests are skipped but kept as infrastructure for when commands are re-enabled.

test.describe.skip('§27 Custom commands', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
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

    const compactItem = fixture.page.locator('[data-testid="picker-item-command-compact"]');
    const clearItem = fixture.page.locator('[data-testid="picker-item-command-clear"]');
    await expect(compactItem).toBeVisible({ timeout: 5_000 });
    await expect(clearItem).toBeVisible({ timeout: 5_000 });

    await fixture.page.keyboard.press('Escape');
  });

  test('selecting /compact sends command and CLI processes it', async () => {
    const composer = fixture.page.getByRole('textbox');
    await composer.click();
    await composer.fill('/');

    const picker = fixture.page.locator('[data-testid="context-picker-menu"]');
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const compactItem = fixture.page.locator('[data-testid="picker-item-command-compact"]');
    await expect(compactItem).toBeVisible({ timeout: 5_000 });
    await compactItem.dispatchEvent('mousedown');

    await expect(composer).toHaveValue('/compact ', { timeout: 3_000 });
    await fixture.page.keyboard.press('Enter');
    await waitForAIIdle(fixture.page, 30_000);

    const commandBubble = fixture.page.locator('[data-testid="user-command-bubble"]').last();
    await expect(commandBubble).toBeVisible({ timeout: 5_000 });
    await expect(commandBubble).toContainText('/compact');
  });

  test('/clear command resets conversation', async () => {
    await chat(fixture.page, 'What is 1 + 1? Reply with just the number.');
    await expect(fixture.page.getByText('2', { exact: true }).first()).toBeVisible();

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

    const commandBubble = fixture.page.locator('[data-testid="user-command-bubble"]').last();
    await expect(commandBubble).toBeVisible({ timeout: 5_000 });
    await expect(commandBubble).toContainText('/clear');
  });
});

test.describe.skip('§27b Command persistence after restart', () => {
  test('commands survive app restart and conversation resumes', async () => {
    const fixture = await launchApp();
    const project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');

    await chat(fixture.page, 'Reply with just the word "RESTART_MARKER".', 60_000);
    await expect(fixture.page.getByText('RESTART_MARKER', { exact: true }).first()).toBeVisible();

    await sendCommandViaPicker(fixture.page, 'compact');
    await expect(fixture.page.getByText('Context compacted').first()).toBeVisible({ timeout: 5_000 });

    const { testDataDir } = fixture;
    await fixture.app.close();

    const { _electron: electron } = await import('@playwright/test');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
    const APP_MAIN = path.default.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

    const app2 = await electron.launch({
      args: [APP_MAIN],
      env: { ...process.env, NODE_ENV: 'development', MAINFRAME_DATA_DIR: testDataDir },
    });
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });

    try {
      await expect(page2.locator('[data-testid="chat-list-item"]').first()).toBeVisible({ timeout: 10_000 });
      await page2.locator('[data-testid="chat-list-item"]').first().click();

      await expect(page2.getByText('RESTART_MARKER', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page2.getByText('Context compacted').first()).toBeVisible({ timeout: 10_000 });

      await chat(page2, 'Reply with just the word "RESUMED".', 60_000);
      await expect(page2.getByText('RESUMED', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await app2.close();
      fixture.daemon.kill();
      await cleanupProject(project);
      const { rmSync } = await import('fs');
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});

test.describe.skip('§27c Context token observation', () => {
  test('/compact executes and reports token counts', async () => {
    const fixture = await launchApp();
    const project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');

    await chat(fixture.page, 'Explain the Fibonacci sequence. Be thorough.', 90_000);
    await chat(fixture.page, 'Now explain merge sort step by step.', 90_000);

    const tokensBefore = await getContextTokens(fixture.page);
    console.log(`[compact] tokens BEFORE: ${tokensBefore}`);

    await sendCommandViaPicker(fixture.page, 'compact');

    const compactedBadge = fixture.page.getByText('Context compacted').first();
    await expect(compactedBadge).toBeVisible({ timeout: 15_000 });

    await chat(fixture.page, 'Reply with just "ok".', 60_000);

    const tokensAfter = await getContextTokens(fixture.page);
    const delta = tokensBefore - tokensAfter;
    console.log(`[compact] tokens AFTER:  ${tokensAfter}`);
    console.log(`[compact] delta: ${delta > 0 ? '-' : '+'}${Math.abs(delta)} tokens`);

    await closeApp(fixture);
    await cleanupProject(project);
  });

  test('/clear executes and reports token counts', async () => {
    const fixture = await launchApp();
    const project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');

    await chat(fixture.page, 'Explain quicksort in detail.', 90_000);
    await chat(fixture.page, 'Now explain binary search trees.', 90_000);

    const tokensBefore = await getContextTokens(fixture.page);
    console.log(`[clear] tokens BEFORE: ${tokensBefore}`);

    await sendCommandViaPicker(fixture.page, 'clear');

    await chat(fixture.page, 'Reply with just "ok".', 60_000);

    const tokensAfter = await getContextTokens(fixture.page);
    const delta = tokensBefore - tokensAfter;
    console.log(`[clear] tokens AFTER:  ${tokensAfter}`);
    console.log(`[clear] delta: ${delta > 0 ? '-' : '+'}${Math.abs(delta)} tokens`);

    await closeApp(fixture);
    await cleanupProject(project);
  });
});
