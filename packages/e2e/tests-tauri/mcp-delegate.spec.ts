/**
 * §mcp-delegate — an agent delegates a task over the orchestration MCP server
 * (docs/specs/2026-10-06-mcp-orchestration-server.md, test plan "E2E").
 *
 * Runs in E2E_MODE=mock. The parent's recording (`mcp-delegate.0`) carries an
 * `mcp_call` step: the mock CLI makes a real `tools/call delegate_task` to the
 * daemon's `/mcp` endpoint with its spawn credential. The daemon creates the
 * child chat, which replays `mcp-delegate.1`; when the child goes idle the
 * daemon holds its result until the parent is idle, then delivers it as the
 * parent's second turn.
 *
 * The child is a task chat: it has no sidebar row, and lives inside the
 * parent's `delegate_task` card, which expands into its live transcript.
 *
 * The three scenarios below (ceiling refusal, Stop cascade, wait mode) each
 * get their own `describe`, own `launchTauriApp`/recording key, and
 * `retries: 0`: the mock CLI's recordings are picked by a per-key spawn
 * counter that only resets with a fresh app/daemon, so sharing one app
 * across tests (as the three tests above do) means a retry's extra
 * `createTauriChat` call would consume the next recording out of order —
 * `retries: 1` is there for live-AI nondeterminism (playwright.config.ts),
 * which does not apply to deterministic mock replay, so there is nothing to
 * gain from retrying these and a real drift risk from doing so.
 *
 * Testid reference:
 *   chat-tool-delegate-task-card / -trigger / -status / -open-<taskId> — the tool card
 *   chat-tool-delegate-task-transcript-<taskId> — the child's transcript inside the card
 *   sessions-row (data-chat-id) — a sidebar row; the child never gets one
 *   chat-task-result-card-<taskId> — the delivered result in the parent
 *   chat-header-tasks-chip / chat-header-task-row-<taskId> — the parent's tasks chip
 *   chat-header-parent-link     — the child's "Delegated by" link
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { DAEMON_BASE } from '../fixtures/daemon.js';

test.describe('§mcp-delegate (mock CLI calls the real /mcp endpoint)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-delegate' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('delegate → the child stays out of the sidebar → result card lands in the parent', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate a race review of the diff to a child chat');

    const card = page.getByTestId('chat-tool-delegate-task-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('Race review');

    const result = page.locator('[data-testid^="chat-task-result-card-"]');
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result).toContainText('No data races found');
    await waitForIdle(page, 60_000);

    await expect(card.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'completed');
    await expect(page.getByTestId('chat-header-tasks-chip')).toHaveText(/1 task done/);
    // The child row has loaded (the card reads its status), yet the sidebar lists only the parent.
    await expect(page.getByTestId('sessions-row')).toHaveCount(1);
    await expect(page.getByTestId('sessions-row-fork-nest')).toHaveCount(0);
  });

  test("the card expands into the child's transcript", async () => {
    const { page } = app;
    const card = page.getByTestId('chat-tool-delegate-task-card');
    await card.getByTestId('chat-tool-delegate-task-trigger').click();
    const transcript = card.locator('[data-testid^="chat-tool-delegate-task-transcript-"]');
    await expect(transcript).toContainText('No data races found', { timeout: 15_000 });
  });

  test('the card opens the child, which links back to its delegator', async () => {
    const { page } = app;
    await page.locator('[data-testid^="chat-tool-delegate-task-open-"]').click();
    const parentLink = page.getByTestId('chat-header-parent-link').first();
    await expect(parentLink).toContainText('Delegated by', { timeout: 15_000 });
    await expect(page.getByTestId('sessions-row')).toHaveCount(1);

    await parentLink.click();
    await expect(page.getByTestId('chat-tool-delegate-task-card')).toBeVisible({ timeout: 15_000 });
  });
});

// Each scenario below owns its app/recording key end to end (see the file
// doc comment) and disables retries: a failure here is deterministic.
test.describe('§mcp-delegate privilege-ceiling refusal', () => {
  test.describe.configure({ retries: 0 });
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-delegate-ceiling' });
    project = await createTauriProject(app.page);
    // `default`: the caller prompts before every edit, well under `yolo`.
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test("a delegate_task call above the caller's privilege mode is refused, not created", async () => {
    const { page } = app;
    await sendMessage(page, 'Try to delegate with a higher permission mode than I have');
    await waitForIdle(page, 60_000);

    // The card still mounts for a refused call (it is keyed on the tool
    // name, not success), but with no parsed TaskResult: expanding it shows
    // the refusal itself, not a child's transcript, and no task status dot.
    const card = page.getByTestId('chat-tool-delegate-task-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('chat-tool-delegate-task-status')).toHaveCount(0);
    await card.getByTestId('chat-tool-delegate-task-trigger').click();
    await expect(card.getByTestId('chat-tool-delegate-task-error')).toContainText('permission_mode_escalation_denied', {
      timeout: 15_000,
    });

    // The ceiling refuses the call before any child chat is created: the
    // sidebar still lists only the caller.
    await expect(page.getByTestId('sessions-row')).toHaveCount(1);
  });
});

test.describe('§mcp-delegate Stop cascade', () => {
  test.describe.configure({ retries: 0 });
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-delegate-stop' });
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('stopping the parent cancels its delegated task (the real Stop cascade)', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate a long task, I will stop you after');

    const card = page.getByTestId('chat-tool-delegate-task-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const status = card.getByTestId('chat-tool-delegate-task-status');
    // The child's recording never completes its turn, so the task stays
    // non-terminal until the Stop below reaches it.
    await expect(status).toHaveAttribute('data-status', 'running', { timeout: 60_000 });

    // The same endpoint the UI's own Stop button calls
    // (`routes/chat_commands.rs::interrupt` → `ChatManager::interrupt_chat`),
    // not `FakePort`: this exercises the real `OrchestrationHooks::
    // on_chat_stopping` → `cascade_stop` path end to end.
    const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/interrupt`, { method: 'POST' });
    expect(res.ok).toBe(true);

    await expect(status).toHaveAttribute('data-status', 'cancelled', { timeout: 15_000 });
  });
});

test.describe('§mcp-delegate wait mode', () => {
  test.describe.configure({ retries: 0 });
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-delegate-wait' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('delegate_task mode "wait" returns the result in the same tool call, no second turn', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate and wait for the result in this same turn');

    const card = page.getByTestId('chat-tool-delegate-task-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    // Unlike async mode (the first describe above), this needs no
    // follow-up sendMessage: the daemon capped the wait at
    // policy::MAX_SINGLE_WAIT_MS (well under the child's own quick
    // completion) and returned the terminal result as this very tool
    // call's answer, inside the parent's first and only turn.
    await expect(card.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'completed', {
      timeout: 15_000,
    });
    await waitForIdle(page, 60_000);
    await expect(page.getByTestId('sessions-row')).toHaveCount(1);
  });
});
