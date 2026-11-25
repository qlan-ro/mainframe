/**
 * §workspace-chats — every secondary chat is a workspace tab (W9): side chats,
 * sessions shown beside the conversation, and what an upgrade from split chats
 * and the side-chat panel leaves behind. Forks and delegated tasks have their
 * own specs (fork-from-message, mcp-delegate).
 *
 * Testid reference:
 *   side-chat-toggle-<parentId>         — the chat header's side-chat button
 *   side-chat-header-<sideId> / side-chat-discard-<sideId> / side-chat-discard-dialog
 *   workspace-tab-chat-<chatId>         — a chat's tab pill (role=tab)
 *   workspace-tab-close-chat-<chatId>   — its close button
 *   workspace-conversation-chat-<chatId> — its body
 *   session-tab-ctx-open-workspace      — the session tab menu's Open in Workspace
 *   chat-task-open-<toolCallId>         — a sub-agent row's Open in workspace
 *   workspace-agent-<header|brief|status|result>-<toolCallId> — the agent tab's parts
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';
import { openWork, toolRow } from '../helpers/tauri/transcript.js';

const CHAT_TABS = '[data-testid^="workspace-tab-chat-"][role="tab"]';
const BODIES = '[data-testid^="workspace-conversation-chat-"]';
const chatTab = (page: Page, chatId: string) => page.getByTestId(`workspace-tab-chat-${chatId}`);
const chatBody = (page: Page, chatId: string) => page.getByTestId(`workspace-conversation-chat-${chatId}`);
const conversation = (page: Page) => page.locator('[data-surface="chat"]');

async function closeChatTab(page: Page, chatId: string): Promise<void> {
  await chatTab(page, chatId).hover();
  await page.getByTestId(`workspace-tab-close-chat-${chatId}`).click();
  await expect(chatTab(page, chatId)).toHaveCount(0);
}

/** Keep a session's tab open: a double click on the preview pins it. */
async function pinTab(page: Page, chatId: string): Promise<void> {
  await page.locator(`[data-testid="sessions-row"][data-chat-id="${chatId}"]`).click();
  await page.getByTestId(`session-tab-${chatId}`).dblclick();
}

test.describe('§workspace-chats', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatA: string;
  let chatB: string;

  test.beforeEach(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatA = await createTauriChat(app.page, project.projectId, 'default');
    chatB = await createTauriChat(app.page, project.projectId, 'default');
    await pinTab(app.page, chatB);
    await pinTab(app.page, chatA);
  });

  test.afterEach(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a side chat opens as a tab, and its unsent message outlives the tab, the session and the workspace', async () => {
    const { page } = app;
    const toggle = page.getByTestId(`side-chat-toggle-${chatA}`);
    await toggle.click();
    const tab = page.locator(CHAT_TABS);
    await expect(tab).toHaveCount(1);
    const sideId = (await tab.getAttribute('data-testid'))!.replace('workspace-tab-chat-', '');
    await expect(chatBody(page, sideId).getByTestId(`side-chat-header-${sideId}`)).toContainText('Side chat');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The chat column holds one conversation: the side chat is nowhere in it.
    await expect(conversation(page).getByTestId('chat-thread')).toHaveCount(1);

    const field = chatBody(page, sideId).getByTestId('chat-composer-input');
    await field.fill('a thought for later');

    await closeChatTab(page, sideId);
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    await toggle.click();
    await expect(field).toHaveValue('a thought for later');

    await page.getByTestId(`session-tab-${chatB}`).click();
    await expect(page.locator(CHAT_TABS)).toHaveCount(0);
    await page.getByTestId(`session-tab-${chatA}`).click();
    await expect(field).toHaveValue('a thought for later');

    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    await page.getByTestId('surface-rail-workspace').click();
    await expect(field).toHaveValue('a thought for later');
  });

  test('a side chat closed by the user stays closed over a restart; one left open comes back', async () => {
    const { page } = app;
    const toggle = page.getByTestId(`side-chat-toggle-${chatA}`);
    await toggle.click();
    await expect(page.locator(CHAT_TABS)).toHaveCount(1);
    await page.reload();
    await waitConnected(page);
    await expect(page.locator(CHAT_TABS)).toHaveCount(1);

    await toggle.click();
    await expect(page.locator(CHAT_TABS)).toHaveCount(0);
    await page.reload();
    await waitConnected(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-side-chat-status', 'idle');
    await expect(page.locator(CHAT_TABS)).toHaveCount(0);
  });

  test('discarding a side chat asks first', async () => {
    const { page } = app;
    const toggle = page.getByTestId(`side-chat-toggle-${chatA}`);
    await toggle.click();
    const discard = page.locator('[data-testid^="side-chat-discard-"]').first();
    await discard.click();
    await page.getByTestId('side-chat-discard-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator(BODIES)).toHaveCount(1);

    await discard.click();
    await page.getByTestId('side-chat-discard-dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator(BODIES)).toHaveCount(0);
    await expect(toggle).toHaveAttribute('data-side-chat-status', 'none', { timeout: 10_000 });
  });

  test('another session opens beside the conversation, and its draft follows it into the chat column', async () => {
    const { page } = app;
    await page.getByTestId(`session-tab-${chatB}`).click({ button: 'right' });
    await page.getByTestId('session-tab-ctx-open-workspace').click();
    const field = chatBody(page, chatB).getByTestId('chat-composer-input');
    await field.fill('written beside');
    // Still the same conversation.
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId(`session-tab-${chatB}`).click();
    const column = conversation(page).getByTestId('chat-composer-input');
    await expect(column).toHaveValue('written beside');
    await column.fill('written beside, then here');

    await page.getByTestId(`session-tab-${chatA}`).click();
    await expect(field).toHaveValue('written beside, then here');
  });

  test('⌘\\ takes the chat in the workspace away', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+Shift+Backslash');
    await expect(chatTab(page, chatB)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(page.locator(CHAT_TABS)).toHaveCount(0);
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
  });

  test('upgrading with a split pair open shows each session beside the other', async () => {
    const { page } = app;
    // What the split-view release left in storage.
    await page.evaluate(
      ([a, b]) => {
        localStorage.setItem(
          'mf:session-tabs',
          JSON.stringify({ v: 3, ids: [a, b], preview: null, zones: [a, b], zonesFrac: 0.6 }),
        );
      },
      [chatA, chatB],
    );
    await page.reload();
    await waitConnected(page);

    await page.getByTestId(`session-tab-${chatA}`).click();
    await expect(chatBody(page, chatB)).toBeVisible();
    await expect(conversation(page).getByTestId('chat-thread')).toHaveCount(1);
    await page.getByTestId(`session-tab-${chatB}`).click();
    await expect(chatBody(page, chatA)).toBeVisible();

    // Once only: closing it there sticks over the next restart.
    await closeChatTab(page, chatA);
    await page.reload();
    await waitConnected(page);
    await page.getByTestId(`session-tab-${chatB}`).click();
    await expect(conversation(page).getByTestId('chat-header')).toBeVisible();
    await expect(page.locator(CHAT_TABS)).toHaveCount(0);
  });

  test('upgrading with a side chat showing opens its tab; one folded away stays closed', async () => {
    const { page } = app;
    await page.getByTestId(`side-chat-toggle-${chatA}`).click();
    await expect(page.locator(CHAT_TABS)).toHaveCount(1);
    await page.getByTestId(`session-tab-${chatB}`).click();
    await page.getByTestId(`side-chat-toggle-${chatB}`).click();
    await expect(page.locator(CHAT_TABS)).toHaveCount(1);

    // As the panel's release would have left it: no tab in any layout, B's panel folded.
    await page.evaluate((folded) => {
      for (const key of Object.keys(localStorage)) {
        if (/^mf:(side-chat-tabs$|session-layout|conversation-tabs)/.test(key)) localStorage.removeItem(key);
      }
      localStorage.setItem(`mf:side-chat-collapsed:${folded}`, 'true');
    }, chatB);
    await page.reload();
    await waitConnected(page);

    await page.getByTestId(`session-tab-${chatA}`).click();
    await expect(page.locator(BODIES)).toHaveCount(1);
    await page.getByTestId(`session-tab-${chatB}`).click();
    const toggle = page.getByTestId(`side-chat-toggle-${chatB}`);
    await expect(toggle).toHaveAttribute('data-side-chat-status', 'idle');
    await expect(page.locator(CHAT_TABS)).toHaveCount(0);
    await toggle.click();
    await expect(page.locator(BODIES)).toHaveCount(1);
  });
});

test.describe('§workspace-chats — agent tab (W8)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'task-subagent' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a sub-agent opens as a tab with its brief, steps and result, and reopens as the same tab', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate finding the greeting export to a subagent');
    await waitForIdle(page, 60_000);
    await sendMessage(page, 'Thanks — what did it find?');
    await waitForIdle(page, 60_000);

    await openWork(page, 0);
    const open = page.locator('[data-testid^="chat-task-open-"]');
    await open.click();
    const agent = page.locator('[data-testid^="workspace-conversation-agent-"]');
    await expect(agent.locator('[data-testid^="workspace-agent-header-"]')).toContainText('Find the greeting export');
    await expect(agent.locator('[data-testid^="workspace-agent-header-"]')).toContainText('general-purpose');
    await expect(agent.locator('[data-testid^="workspace-agent-brief-"]')).toContainText('Search the project');
    await expect(toolRow(agent, 'Bash')).toHaveCount(1);
    await expect(agent.locator('[data-testid^="workspace-agent-result-"]')).toContainText('index.ts');
    await expect(agent.locator('[data-testid^="workspace-agent-status-"]')).toHaveCount(0);
    // Read-only: the one composer on screen is the conversation's.
    await expect(page.getByTestId('chat-composer-input')).toHaveCount(1);

    await open.click();
    await expect(page.locator('[data-testid^="workspace-tab-agent-"][role="tab"]')).toHaveCount(1);

    // It survives a restart, read back from the transcript.
    await page.reload();
    await waitConnected(page);
    await expect(agent.locator('[data-testid^="workspace-agent-result-"]')).toContainText('index.ts', {
      timeout: 15_000,
    });
  });
});
