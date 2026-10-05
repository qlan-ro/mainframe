/**
 * §new-session-prefill — "New session" prefill actions on an empty new-thread
 * slot (#359).
 *
 * `openNewThreadDraft`'s new-thread slot reads empty for one macrotask right
 * after a draft's first send commits it (assistant-ui 0.15's `threads` scope).
 * That state is only reachable by sending a chat's FIRST message through the
 * UI — `createTauriChat` creates the chat over REST and never takes the
 * draft-commit path, so it can't reproduce this (see its own docstring).
 *
 * Only the recording's FIRST turn is used (a plain "4" reply, no tool call) —
 * deliberately, not the richer second turn composer-advanced.spec.ts selects
 * from: that turn's Bash tool call is a SECOND `in` marker the mock replays
 * positionally, and this spec's own first send already travels a path
 * (draft → first-send chat creation) that recording never has to share with a
 * REST-created chat's first send. One turn is both sufficient — the bug is in
 * the slot read after the switch, not in what the reply says — and robust.
 *
 * Testid reference (verified against source, mirrors sessions-draft.spec.ts /
 * composer-advanced.spec.ts):
 *   sidebar-action-new-thread  — the sidebar's "New session" row (the redesign retired
 *                                 the standalone sessions-new-button pill)
 *   sessions-welcome           — WelcomeState root (the draft empty state)
 *   welcome-project            — the welcome screen's project trigger — the chat header's
 *                                 project chip died with ChatCardHeader, so this (already
 *                                 shown above a prefilled draft, since zero messages are
 *                                 sent yet) is the one place that still names the project
 *   chat-selection-toolbar     — floating toolbar on a text selection
 *   chat-selection-new-session — its "New session" action
 *   chat-composer-input        — the composer (present only once a draft has a project)
 *
 * A selection must sit inside `.aui-md` — `body` is `user-select: none`
 * (globals.css), so a Range outside it is accepted by `addRange` but reads as
 * an empty string (see composer-advanced.spec.ts's identical walker).
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';
import { TOAST } from '../helpers/tauri/testids.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] as string;
}

/** `GET /api/chats?project=<id>` — mirrors sessions-draft.spec.ts's identically-named helper. */
async function fetchProjectChatIds(projectId: string): Promise<string[]> {
  const res = await fetch(`${DAEMON_BASE}/api/chats?project=${encodeURIComponent(projectId)}`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((chat) => chat.id);
}

/**
 * Poll the daemon until EXACTLY ONE chat exists in `projectId` that did not exist
 * before, and return its id — the daemon is the authority on "a chat was
 * created" (see sessions-draft.spec.ts's identically-named helper for why a
 * sidebar DOM diff is not).
 */
async function waitForCreatedChat(projectId: string, before: string[]): Promise<string> {
  const known = new Set(before);
  let created: string[] = [];
  await expect
    .poll(
      async () => {
        created = (await fetchProjectChatIds(projectId)).filter((id) => !known.has(id));
        return created.length;
      },
      { timeout: 20_000 },
    )
    .toBe(1);
  return created[0] as string;
}

async function pickProjectFromWelcome(page: Page, projectId: string): Promise<void> {
  await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('welcome-project')).toContainText('Choose a project');
  await page.getByTestId('welcome-project').click();
  await page.getByTestId(`welcome-project-${projectId}`).click();
  await expect(page.getByTestId('welcome-project-picker')).toHaveCount(0);
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
}

function capturePrompts(page: Page): Array<{ sessionId: string; prompt: Array<{ type: string; text?: string }> }> {
  const prompts: Array<{ sessionId: string; prompt: Array<{ type: string; text?: string }> }> = [];
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/acp/')) return;
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(payload.toString()) as { method?: string; params: (typeof prompts)[number] };
      if (request.method === 'session/prompt') prompts.push(request.params);
    });
  });
  return prompts;
}

async function expectUnarchivedChat(chatId: string): Promise<void> {
  const response = await fetch(`${DAEMON_BASE}/api/chats/${chatId}`);
  expect(response.ok).toBe(true);
  const body = (await response.json()) as { data: { id: string; status: string } };
  expect(body.data.id).toBe(chatId);
  expect(body.data.status).not.toBe('archived');
}

/**
 * The last assistant message's rendered markdown (`.aui-md`) — the reply text
 * alone. The whole message row also carries its timestamp, so a
 * `toContainText('4')` on the row passes on e.g. "08:24 PM" before any reply
 * has rendered.
 */
function lastReplyMarkdown(page: Page): Locator {
  return page.getByTestId('chat-assistant-message').last().locator('.aui-md');
}

/**
 * Select the given text inside the last assistant message's rendered markdown
 * and fire the native 'mouseup' SelectionToolbarPrimitive.Root listens for.
 * Mirrors composer-advanced.spec.ts's identical walker (see its docstring for
 * why the walk is scoped to `.aui-md` and not the whole message).
 */
async function selectTextInLastAssistantMessage(page: Page, needle: string): Promise<string> {
  return page.evaluate((target) => {
    const messages = document.querySelectorAll('[data-testid="chat-assistant-message"]');
    const last = messages[messages.length - 1];
    if (!last) throw new Error('no assistant message found');
    const markdown = last.querySelector('.aui-md');
    if (!markdown) throw new Error('no rendered markdown (.aui-md) in the assistant message');
    const walker = document.createTreeWalker(markdown, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node as Text;
      if (t.textContent?.includes(target)) {
        textNode = t;
        break;
      }
    }
    if (!textNode?.textContent) throw new Error(`selection target "${target}" not found`);
    const idx = textNode.textContent.indexOf(target);
    const range = document.createRange();
    range.setStart(textNode, idx);
    range.setEnd(textNode, idx + target.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const text = sel?.toString() ?? '';
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return text;
  }, needle);
}

async function createWelcomeChat(
  page: Page,
  project: TauriProject,
  prompts: ReturnType<typeof capturePrompts>,
): Promise<string> {
  const chatsBeforeDraft = await fetchProjectChatIds(project.projectId);
  await pickProjectFromWelcome(page, project.projectId);
  const firstPrompt = 'What is 2 + 2? Reply with just the number.';
  await sendMessage(page, firstPrompt);
  const committedChatId = await waitForCreatedChat(project.projectId, chatsBeforeDraft);
  await expect(lastReplyMarkdown(page)).toHaveText('4', { timeout: 60_000 });
  await waitForIdle(page, 60_000);
  expect(prompts).toContainEqual(
    expect.objectContaining({
      sessionId: committedChatId,
      prompt: [{ type: 'text', text: firstPrompt }],
    }),
  );
  expect((await fetchProjectChatIds(project.projectId)).filter((id) => !chatsBeforeDraft.includes(id))).toEqual([
    committedChatId,
  ]);
  await expectUnarchivedChat(committedChatId);
  return committedChatId;
}

test.describe('§new-session-prefill', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let committedChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    const prompts = capturePrompts(app.page);
    project = await createTauriProject(app.page);
    committedChatId = await createWelcomeChat(app.page, project, prompts);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('"New session" on selected reply text opens a draft in the source project, prefilled, with no error toast', async () => {
    const { page } = app;
    await expect(lastReplyMarkdown(page)).toHaveText('4', { timeout: 10_000 });

    const selected = await selectTextInLastAssistantMessage(page, '4');
    expect(selected).toBe('4');

    await expect(page.getByTestId('chat-selection-toolbar')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('chat-selection-new-session').click();

    // A composer, not "Choose a project" — the draft carries the source
    // chat's project even though the slot it landed on was empty.
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('4', { timeout: 10_000 });
    await expect(page.getByTestId('welcome-project')).toContainText(baseName(project.projectPath));
    await expect(page.locator(`${TOAST.root}[data-type="error"]`)).toHaveCount(0);
  });

  test('the sidebar "+" from the same freshly committed chat also opens a draft in the active project, not "Choose a project"', async () => {
    const { page } = app;
    await sessionsSidebar(page).row(committedChatId).click();
    await expect(sessionsSidebar(page).row(committedChatId)).toHaveAttribute('data-active', 'true', {
      timeout: 10_000,
    });

    await sessionsSidebar(page).newButton().click({ timeout: 10_000 });
    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('welcome-project')).toContainText(baseName(project.projectPath), {
      timeout: 10_000,
    });
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 10_000 });
  });
});
