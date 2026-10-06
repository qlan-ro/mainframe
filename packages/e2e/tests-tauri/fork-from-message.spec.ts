/**
 * §fork-from-message — "Fork from here" on a sent user message
 * (docs/specs/2026-10-06-fork-from-message.md).
 *
 * Runs in E2E_MODE=mock against the `messaging` recording (two prompts). With
 * `mockFork`, the daemon registers the mock adapter as fork-capable
 * (E2E_MOCK_FORK=1); without it the button is disabled with the adapter hint.
 *
 * Testid reference:
 *   chat-user-message          — user turn root (carries data-message-id)
 *   chat-user-message-fork     — the hover bar's "Fork from here" button
 *   chat-header-parent-link    — the fork's link back to its parent
 *   chat-composer-input        — composer textarea (one per visible zone)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

const PROMPT_1 = 'What is 2 + 2? Reply with just the number.';
const PROMPT_2 = 'List the files in this project using bash ls.';

const userMessage = (page: Page, index: number) => page.locator('[data-testid="chat-user-message"]').nth(index);

/** The fork button lives in a hover bar, so hover its message first. */
async function forkButton(page: Page, index: number) {
  await userMessage(page, index).hover();
  return userMessage(page, index).locator('[data-testid="chat-user-message-fork"]');
}

async function sendBothPrompts(page: Page) {
  await sendMessage(page, PROMPT_1);
  await waitForIdle(page, 60_000);
  await sendMessage(page, PROMPT_2);
  await waitForIdle(page, 90_000);
}

test.describe('§fork-from-message (fork-capable mock)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging', mockFork: true });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('is disabled on the first message, with its hint', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeDisabled();
    await button.locator('..').hover();
    await expect(page.getByRole('tooltip')).toContainText('Nothing before this message to fork');
  });

  test('forks before the second message and prefills its text', async () => {
    const { page } = app;
    const button = await forkButton(page, 1);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.locator('[data-testid="chat-header-parent-link"]').first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() =>
        page
          .locator('[data-testid="chat-composer-input"]')
          .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value)),
      )
      .toContain(PROMPT_2);
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
    const button = await forkButton(page, 1);
    await expect(button).toBeDisabled();
    await button.locator('..').hover();
    await expect(page.getByRole('tooltip')).toContainText("Forking isn't available for Mock CLI chats yet");
  });
});
