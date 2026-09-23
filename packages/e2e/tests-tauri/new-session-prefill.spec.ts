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
 * `beforeAll` reaches that first-send path through `openDraftInheritingProject`
 * (sessions-draft.spec.ts) rather than the welcome screen's project-picker
 * dropdown: it seeds a real, project-backed chat with `createTauriChat` first,
 * so the sidebar "+" inherits that chat's project directly — no
 * `welcome-project` Radix trigger, no `onSelect`/`flushSync` frame. That
 * dropdown path — `pickProjectFromWelcome`'s `welcome-project-<id>` click —
 * is what reproduced a separate, pre-existing race in `use-draft-row.ts`'s
 * discard-on-navigate-away effect (see git history on this file for the
 * live-verified repro); it archived the just-created chat ~36ms after
 * creation. `sessions-draft.spec.ts`'s "first send creates exactly one chat"
 * test takes the same inherited-project route and does not hit that race, so
 * this spec now shares it instead of the dropdown path. The race itself is
 * unrelated to #359's fix and is tracked separately (see the project's issue
 * tracker) rather than fixed here.
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
 *   sessions-new-button        — the sidebar "+" (SessionsNewButton.tsx)
 *   sessions-welcome           — WelcomeState root (the draft empty state)
 *   welcome-project            — the welcome screen's project trigger
 *   chat-header-project        — the header's project chip (draft or real chat)
 *   chat-selection-toolbar     — floating toolbar on a text selection
 *   chat-selection-new-session — its "New session" action
 *   chat-composer-input        — the composer (present only once a draft has a project)
 *
 * A selection must sit inside `.aui-md` — `body` is `user-select: none`
 * (globals.css), so a Range outside it is accepted by `addRange` but reads as
 * an empty string (see composer-advanced.spec.ts's identical walker).
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
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

/**
 * The one-click "+" with a project-backed session already active and no
 * filter pill: `resolveNewSessionProject` inherits that session's project, so
 * the welcome screen opens with it already picked — draft row and composer
 * live immediately, no dropdown step (mirrors sessions-draft.spec.ts's
 * identically-named helper).
 */
async function openDraftInheritingProject(page: Page, project: TauriProject): Promise<void> {
  await sessionsSidebar(page).newButton().click({ timeout: 10_000 });
  await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('welcome-project')).toContainText(baseName(project.projectPath), {
    timeout: 10_000,
  });
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

test.describe('§new-session-prefill', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  /** The chat committed by `beforeAll`'s own first send — distinct from the
   *  chat `createTauriChat` seeds to give "+" a project to inherit. */
  let committedChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);

    const { page } = app;
    // Seed a real, project-backed chat first so the sidebar "+" inherits its
    // project directly (openDraftInheritingProject below) instead of going
    // through the welcome screen's project-picker dropdown — see the file
    // docstring for why that dropdown path is avoided here.
    const seededChatId = await createTauriChat(page, project.projectId, 'default');
    const chatsBeforeDraft = await fetchProjectChatIds(project.projectId);

    await openDraftInheritingProject(page, project);
    // Let the draft settle (config resolved, composer mounted) before typing —
    // sessions-draft.spec.ts's identical inherit→submit sequence waits on both
    // of these first for the same reason.
    await expect(page.getByTestId('sessions-draft-row')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('chat-header-project')).toContainText(baseName(project.projectPath), {
      timeout: 10_000,
    });
    // Let the draft's async initializeDraft (provider-settings fetch, etc.)
    // fully settle before typing — sending too early raced the app into
    // archiving its own just-created chat in a couple of manual repros.
    await page.waitForLoadState('networkidle');

    // First send commits the draft — the new-thread slot then reads empty for
    // one macrotask (#359's root cause) until it observes the settled draft.
    // Confirm the commit itself via the daemon (a second, distinct chat now
    // exists in the project) before waiting on the reply — sessions-draft.spec.ts's
    // "first send creates exactly one chat" test asserts the identical thing
    // before its own waitForIdle.
    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    committedChatId = await waitForCreatedChat(project.projectId, chatsBeforeDraft);
    expect(committedChatId).not.toBe(seededChatId);
    await waitForIdle(page, 60_000);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('"New session" on selected reply text opens a draft in the source project, prefilled, with no error toast', async () => {
    const { page } = app;
    const lastAssistant = page.getByTestId('chat-assistant-message').last();
    await expect(lastAssistant).toContainText('4', { timeout: 10_000 });

    const selected = await selectTextInLastAssistantMessage(page, '4');
    expect(selected).toBe('4');

    await expect(page.getByTestId('chat-selection-toolbar')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('chat-selection-new-session').click();

    // A composer, not "Choose a project" — the draft carries the source
    // chat's project even though the slot it landed on was empty.
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('4', { timeout: 10_000 });
    await expect(page.getByTestId('chat-header-project')).toContainText(baseName(project.projectPath));
    await expect(page.locator(`${TOAST.root}[data-type="error"]`)).toHaveCount(0);
  });

  test('the sidebar "+" from the same freshly committed chat also opens a draft in the active project, not "Choose a project"', async () => {
    const { page } = app;
    // Return to the real chat committed in beforeAll (the New-session test
    // above branched off it into a separate draft) — addressed by its own id
    // since the seeded chat from beforeAll also has a `sessions-row`. A real
    // (non-draft) chat's header never renders `chat-header-project`
    // (ChatCardHeaderReal carries no project chip — only ChatCardHeaderDraft
    // does), so the switch is confirmed via the row's `data-active` instead.
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
