/**
 * §facade-protocol partial-retry — PR #688 review-fix verification scenario 1
 * ("a partial stream interrupted by a provider retry leaves no ghost bubble",
 * plan `docs/plans/2026-09-14-pr-688-review-fixes-plan.md` Verification step 7).
 *
 * The `retry-partial` recording streams a partial block under the API message id
 * `msg_A`, then fires `onApiRetry(1, "overloaded_error")`, then delivers the
 * retried call's completed message. Two halves, one recording, one daemon each:
 *
 *   - wire half (raw `/acp/{profile}` socket, no browser `page`): `msg_A` is
 *     created once and cleared once (`content: []`, T23/`session_state.rs::
 *     clear_update`) and never mentioned again, and the `attempt: 1` marker rides
 *     the retried call's own content frame, not the clearing one (T16).
 *   - UI half: the transcript ends with exactly one assistant bubble, carrying
 *     the completed text — the ghost this scenario guards against is a second,
 *     permanently empty `chat-assistant-message`.
 *
 * `mockMaxDelayMs` widens the mock adapter's 120ms replay clamp so the partial,
 * the retry, and the completed message land as three separated states rather
 * than one burst — the UI half's transient partial bubble has no window otherwise.
 */
import { test, expect } from '@playwright/test';
import { startDaemon, stopDaemon, type DaemonHandle } from '../fixtures/daemon.js';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import {
  createHeadlessProject,
  createHeadlessChat,
  cleanupHeadlessProject,
  type HeadlessProject,
} from '../helpers/tauri/headless-chat.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { chatThread } from '../helpers/tauri/page-objects.js';
import { sendJson, collectFrames, collectUntilQuiet, closeSocket } from '../helpers/tauri/raw-ws-client.js';
import {
  promptRequest,
  resumeRequest,
  updates,
  itemId,
  mainframeMeta,
  connectAndInitialize,
  expectReplayClosedAfterQueueState,
  type SessionUpdateFrame,
} from '../helpers/tauri/facade-protocol-support.js';

/** Wide enough that the recording's 300 / 1500 / 2500ms marks stay distinct. */
const MOCK_MAX_DELAY_MS = 3_000;
const PROMPT = 'Start answering, then hit a provider retry';
const COMPLETED_TEXT = 'RETRY-PARTIAL-DONE: the retried call answered in full.';

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block as { text?: string }).text ?? '')
    .join('')
    .trim();
}

test.describe('§facade-protocol partial-retry (wire)', () => {
  let handle: DaemonHandle;
  let project: HeadlessProject;
  let chatId: string;

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'retry-partial', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    project = await createHeadlessProject();
    chatId = await createHeadlessChat(project.projectId);
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
    cleanupHeadlessProject(project);
  });

  test('a retry-aborted partial is cleared once and never mentioned again; the retry marker rides the retried content', async () => {
    const ws = await connectAndInitialize();
    sendJson(ws, promptRequest(2, chatId, PROMPT));
    const frames = updates(await collectUntilQuiet(ws, 1_800, 30_000));
    await closeSocket(ws);

    // The partial's item id is the recording's API message id verbatim
    // (spec decision 23: the item id IS the message id).
    const partialFrames = frames.filter((frame) => itemId(frame) === 'msg_A');
    expect(partialFrames.map((frame) => frame.params?.update?.sessionUpdate)).toEqual([
      'agent_message',
      'agent_message',
    ]);
    expect(textOf(partialFrames[0]?.params?.update?.content)).toBe('Starting to ans');
    // The clearing upsert: content replaced with the empty list. The client
    // deletes the item on receipt (T23), so a bubble can never outlive it.
    expect(partialFrames[1]?.params?.update?.content).toEqual([]);
    // Spec Decision 37: only the create carries the creation marker, never the clear.
    expect(mainframeMeta(partialFrames[0]!)?.created).toBe(true);
    expect(mainframeMeta(partialFrames[1]!)?.created).toBeUndefined();

    // The retry marker never rides the clearing frame (T16) — it rides the
    // retried call's own content, which is a different item.
    const marked = frames.filter((frame) => frame.params?.update?._meta?.['_mainframe.dev']?.attempt !== undefined);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.params?.update?._meta?.['_mainframe.dev']?.attempt).toBe(1);
    expect(marked[0]?.params?.update?._meta?.['_mainframe.dev']?.reason).toBe('overloaded_error');
    expect(itemId(marked[0] as SessionUpdateFrame)).not.toBe('msg_A');
    expect(textOf(marked[0]?.params?.update?.content)).toBe(COMPLETED_TEXT);
    // The marker merges into the retried item's create: it keeps the creation
    // marker and the full item meta, not a namespace holding only attempt/reason.
    expect(mainframeMeta(marked[0]!)?.created).toBe(true);
    expect(mainframeMeta(marked[0]!)?.containerId).toBeTruthy();
  });

  test('a resume from start replays only the completed item and closes with replay_complete', async () => {
    const ws = await connectAndInitialize();
    const collected = collectUntilQuiet(ws, 1_500, 15_000);
    const replies = collectFrames(ws);
    sendJson(ws, resumeRequest(2, chatId, { type: 'start' }));
    const reply = await replies.next((f) => f['id'] === 2);
    expect(reply['error']).toBeUndefined();
    const frames = await collected;
    await closeSocket(ws);

    expectReplayClosedAfterQueueState(frames, chatId, 2);
    const replayed = updates(frames);
    expect(replayed.filter((frame) => itemId(frame) === 'msg_A')).toHaveLength(0);
    const agentTexts = replayed
      .filter((frame) => frame.params?.update?.sessionUpdate === 'agent_message')
      .map((frame) => textOf(frame.params?.update?.content));
    expect(agentTexts).toEqual([COMPLETED_TEXT]);
  });
});

test.describe('§facade-protocol partial-retry (UI)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'retry-partial', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('the aborted partial bubble is gone after the retry: one assistant message, none empty', async () => {
    const { page } = app;
    const thread = chatThread(page);
    await sendMessage(page, PROMPT);

    // Precondition, asserted not assumed: the partial really did render, so the
    // "no ghost" assertion below is not passing vacuously on a bubble that never
    // existed.
    await expect(thread.assistantMessages().filter({ hasText: 'Starting to ans' })).toHaveCount(1, {
      timeout: 20_000,
    });

    await expect(page.getByText(COMPLETED_TEXT, { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);

    // The ghost this guards against is a second, permanently empty assistant
    // bubble left behind by the cleared partial.
    await expect(thread.assistantMessages()).toHaveCount(1);
    await expect(thread.assistantMessages()).toContainText(COMPLETED_TEXT);
    await expect(thread.assistantMessages().filter({ hasText: 'Starting to ans' })).toHaveCount(0);
  });
});
