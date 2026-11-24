/**
 * §fork-from-message — "Fork from here" after an assistant turn.
 *
 * Runs in E2E_MODE=mock against the `messaging` recording (two prompts). With
 * `mockFork`, the daemon registers the mock adapter as fork-capable.
 *
 * Testid reference:
 *   chat-assistant-message     — assistant turn root
 *   chat-assistant-message-fork — the turn's "Fork from here" button
 *   chat-header-parent-link    — the fork's link back to its parent
 *   workspace-conversation-chat-<chatId> — a chat tab's body in the workspace
 *   chat-composer-input        — composer textarea (the conversation's, and one per chat tab)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

const PROMPT_1 = 'What is 2 + 2? Reply with just the number.';
const PROMPT_2 = 'List the files in this project using bash ls.';

const assistantMessage = (page: Page, index: number) => page.getByTestId('chat-assistant-message').nth(index);

async function forkButton(page: Page, index: number) {
  await assistantMessage(page, index).hover();
  return assistantMessage(page, index).getByTestId('chat-assistant-message-fork');
}

async function sendBothPrompts(page: Page) {
  await sendMessage(page, PROMPT_1);
  await waitForIdle(page, 60_000);
  await sendMessage(page, PROMPT_2);
  await waitForIdle(page, 90_000);
}

/** The conversation's own column, which a fork never takes over. */
const conversation = (page: Page) => page.locator('[data-surface="chat"]');

/** The one chat tab open in the workspace. */
const forkTab = (page: Page) => page.locator('[data-testid^="workspace-conversation-chat-"]');

test.describe('§fork-from-message (fork-capable mock)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let parentChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging', mockFork: true });
    project = await createTauriProject(app.page);
    parentChatId = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('offers forks after earlier and latest completed assistant turns', async () => {
    const { page } = app;
    await expect(await forkButton(page, 0)).toBeEnabled();
    await expect(await forkButton(page, 1)).toBeEnabled();
  });

  test('forks after the first turn with an empty composer and cuts the transcript there', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeEnabled();
    await button.click();

    // The fork opens as a workspace tab; the parent stays the conversation.
    await expect(forkTab(page).getByTestId('chat-header-parent-link')).toContainText('Forked from', {
      timeout: 15_000,
    });

    // The parent is untouched: both prompts (and the fork point itself) still
    // show in its own transcript.
    const parentMessages = conversation(page).locator('[data-testid="chat-user-message"]');
    await expect(parentMessages).toHaveCount(2);
    await expect(parentMessages.nth(0)).toContainText(PROMPT_1);
    await expect(parentMessages.nth(1)).toContainText(PROMPT_2);

    // The fork holds the first turn, while the later prompt stays only in the parent.
    const forkMessages = forkTab(page).locator('[data-testid="chat-user-message"]');
    await expect(forkMessages).toHaveCount(1);
    await expect(forkMessages.first()).toContainText(PROMPT_1);
    await expect(forkMessages).not.toContainText(PROMPT_2);
    await expect(forkTab(page).getByTestId('chat-composer-input')).toBeEmpty();
  });

  test('keeps an unsent message in the fork: tab closed, reopened, and moved to the chat column', async () => {
    const { page } = app;
    const unsent = 'not sent yet';
    const tab = page.locator('[data-testid^="workspace-tab-chat-"][role="tab"]');
    const forkId = (await tab.getAttribute('data-testid'))!.replace('workspace-tab-chat-', '');
    await forkTab(page).getByTestId('chat-composer-input').fill(unsent);

    await tab.hover();
    await page.getByTestId(`workspace-tab-close-chat-${forkId}`).click();
    await expect(forkTab(page)).toHaveCount(0);
    // The last tab went, so the workspace collapsed (W5). The fork is a session like any other.
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    const row = page.locator(`[data-testid="sessions-row"][data-chat-id="${forkId}"]`);
    await row.click({ button: 'right' });
    await page.getByTestId('sessions-ctx-open-workspace').click();
    await expect(forkTab(page).getByTestId('chat-composer-input')).toHaveValue(unsent);

    await forkTab(page).getByTestId(`workspace-chat-promote-${forkId}`).click();
    await expect(conversation(page).getByTestId('chat-composer-input')).toHaveValue(unsent);
    await expect(forkTab(page)).toHaveCount(0);

    // Back to the parent, whose workspace still has the tab, and so does the message.
    await page.getByTestId(`session-tab-${parentChatId}`).click();
    await expect(forkTab(page).getByTestId('chat-composer-input')).toHaveValue(unsent);
  });
});

test.describe('§fork-from-message (mock without fork)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('is disabled with the adapter hint', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeDisabled();
    await button.locator('..').hover();
    await expect(page.getByRole('tooltip')).toContainText("Forking isn't available for Mock CLI chats yet");
  });
});
