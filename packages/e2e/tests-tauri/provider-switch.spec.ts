/**
 * §provider-switch — continue a chat on another provider in place
 * (docs/specs/2026-10-06-provider-switch-in-place.md).
 *
 * Runs in E2E_MODE=mock with `mockSwitch`, which registers a second replay
 * adapter, `mock-cli-b` ("Mock CLI B"), beside `mock-cli` (E2E_MOCK_SWITCH=1).
 * Both replay the `messaging` recording; B reads E2E_RECORDING_KEY_MOCK_CLI_B
 * when set.
 *
 * Testid reference:
 *   composer-model-select                         — the provider/model menu trigger
 *   composer-adapter-select-option-<adapterId>    — a provider tab in that menu
 *   composer-model-select-option-<modelId>        — a model row
 *   composer-provider-switch-confirm(-confirm)    — the switch confirmation
 *   chat-provider-switch-marker-<segmentId>       — the divider a segment opens with
 *   chat-user-message                             — user turn root
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';

const PROMPT_1 = 'What is 2 + 2? Reply with just the number.';
const PROMPT_2 = 'List the files in this project using bash ls.';
const PROMPT_3 = 'What is 3 + 3? Reply with just the number.';
const MODEL = 'claude-haiku-4-5-20251001';
const HANDOFF_TAG = 'mainframe-context-handoff';

const dividers = (page: Page) => page.locator('[data-testid^="chat-provider-switch-marker-"]');

/** Opens the model menu, browses `adapterId`'s catalog and confirms the switch. */
async function switchTo(page: Page, adapterId: string) {
  await page.getByTestId('composer-model-select').first().click();
  await page.getByTestId(`composer-adapter-select-option-${adapterId}`).click();
  await page.getByTestId(`composer-model-select-option-${MODEL}`).click();
  await page.getByTestId('composer-provider-switch-confirm-confirm').click();
  await expect(page.getByTestId('composer-provider-switch-confirm')).toBeHidden();
}

test.describe('§provider-switch (two mock adapters)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging', mockSwitch: true });
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendMessage(app.page, PROMPT_1);
    await waitForIdle(app.page, 60_000);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('switching opens a divider that waits for the next message', async () => {
    const { page } = app;
    await switchTo(page, 'mock-cli-b');
    await expect(dividers(page)).toHaveCount(1);
    await expect(dividers(page).first()).toContainText('Switched to Mock CLI B');
    await expect(dividers(page).first()).toContainText('context hands off with your next message');
  });

  test('the next message hands the context off without showing the block', async () => {
    const { page } = app;
    await sendMessage(page, PROMPT_2);
    await waitForIdle(page, 90_000);
    await expect(dividers(page).first()).toContainText('context handed off');
    const users = page.locator('[data-testid="chat-user-message"]');
    await expect(users.last()).toContainText(PROMPT_2);
    await expect(users.last()).not.toContainText(HANDOFF_TAG);
  });

  test('the divider and the clean message survive a reload', async () => {
    const { page } = app;
    await page.reload();
    await waitConnected(page, 15_000);
    await sessionsSidebar(page).row(chatId).click();
    await expect(dividers(page).first()).toContainText('Switched to Mock CLI B', { timeout: 15_000 });
    await expect(dividers(page).first()).toContainText('context handed off');
    await expect(page.locator('[data-testid="chat-user-message"]').filter({ hasText: HANDOFF_TAG })).toHaveCount(0);
  });

  test('switching back resumes the earlier session', async () => {
    const { page } = app;
    await switchTo(page, 'mock-cli');
    await expect(dividers(page)).toHaveCount(2);
    await expect(dividers(page).last()).toContainText('Back to Mock CLI');
    await expect(dividers(page).last()).toContainText('resumes its earlier session with your next message');

    // The pending "Back to" divider only resolves once a message actually
    // hands the context off — assert the round trip, not just the pending copy.
    await sendMessage(page, PROMPT_3);
    await waitForIdle(page, 90_000);
    await expect(dividers(page)).toHaveCount(2);
    await expect(dividers(page).last()).toContainText('Back to Mock CLI');
    await expect(dividers(page).last()).toContainText('resumed earlier session');
    await expect(dividers(page).last()).toContainText('caught up');
    const users = page.locator('[data-testid="chat-user-message"]');
    await expect(users.last()).toContainText(PROMPT_3);
    await expect(users.last()).not.toContainText(HANDOFF_TAG);
  });
});
