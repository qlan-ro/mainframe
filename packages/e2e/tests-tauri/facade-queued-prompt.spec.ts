/**
 * §facade-queued-prompt — PR #688 review-fix verification scenario 3
 * ("a prompt queued behind a running turn appears last and stays last after the
 * dequeue", plan `docs/plans/2026-09-14-pr-688-review-fixes-plan.md` Verification
 * step 7).
 *
 * Spec decision D1: a queued turn leaves the transcript entirely. The encoder drops
 * any message carrying `queued` metadata (`encoder.rs::is_queued`), so a queued
 * prompt renders from the `_mainframe.dev/queue_state` snapshot alone and its
 * dequeue is a plain create at the tail — never a reorder, which the wire cannot
 * express. The regression this guards is the queued user message being encoded at
 * send time, which puts it ABOVE the output of the turn it is waiting on.
 *
 * The `queued-prompt` recording holds turn 1 open for 3s on its `onResult` (the
 * mock's release signal); `mockMaxDelayMs` widens the 120ms replay clamp so that
 * window is real. The mock synthesizes the dequeue ack from the daemon's live uuid,
 * so the fixture carries no `onQueuedProcessed` line.
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
import { sendJson, nextJsonMessage, collectUntilQuiet, closeSocket } from '../helpers/tauri/raw-ws-client.js';
import { promptRequest, connectAndInitialize } from '../helpers/tauri/facade-protocol-support.js';

/** Turn 1 parks 3s on its `onResult`; the clamp must not collapse that window. */
const MOCK_MAX_DELAY_MS = 3_000;
const RUNNING_PROMPT = 'Take your time on the first turn';
const QUEUED_PROMPT = 'And now the prompt that waited';
const RUNNING_ANSWER = 'TURN-ONE-ANSWER: the running turn finished.';
const QUEUED_ANSWER = 'TURN-TWO-ANSWER: the queued prompt ran second.';

interface Frame {
  method?: string;
  params?: {
    refs?: { content?: string }[];
    update?: { sessionUpdate?: string; messageId?: string; content?: unknown };
  };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block as { text?: string }).text ?? '')
    .join('')
    .trim();
}

function queueSnapshots(frames: Frame[]): Frame[] {
  return frames.filter((frame) => frame.method === '_mainframe.dev/queue_state');
}

function refContents(frame: Frame | undefined): string[] {
  return (frame?.params?.refs ?? []).map((ref) => ref.content ?? '');
}

/** Index of the first `session/update` creating a message item with exactly `text`. */
function indexOfCreate(frames: Frame[], sessionUpdate: string, text: string): number {
  return frames.findIndex(
    (frame) =>
      frame.method === 'session/update' &&
      frame.params?.update?.sessionUpdate === sessionUpdate &&
      textOf(frame.params.update.content) === text,
  );
}

test.describe('§facade-queued-prompt (wire)', () => {
  let handle: DaemonHandle;
  let project: HeadlessProject;
  let chatId: string;

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'queued-prompt', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    project = await createHeadlessProject();
    chatId = await createHeadlessChat(project.projectId);
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
    cleanupHeadlessProject(project);
  });

  test('the queued prompt is announced in queue_state while it waits, and created only after the running turn’s last item', async () => {
    test.setTimeout(90_000);
    const ws = await connectAndInitialize();
    sendJson(ws, promptRequest(2, chatId, RUNNING_PROMPT));
    await nextJsonMessage(ws);
    sendJson(ws, promptRequest(3, chatId, QUEUED_PROMPT));
    const frames = (await collectUntilQuiet(ws, 3_000, 40_000)) as Frame[];
    await closeSocket(ws);

    // While turn 1 runs, the second prompt lives in the queue snapshot — with its
    // real content, which is what the client renders it from (D1).
    const queuedSnapshotIndex = frames.findIndex(
      (frame) => frame.method === '_mainframe.dev/queue_state' && refContents(frame).includes(QUEUED_PROMPT),
    );
    expect(queuedSnapshotIndex, 'queue_state must announce the mid-turn prompt').toBeGreaterThanOrEqual(0);
    expect(refContents(frames[queuedSnapshotIndex])).toEqual([QUEUED_PROMPT]);

    // …and NOT in the transcript. Its user item is created only on the dequeue,
    // after the running turn's own last item — a create above that answer is the
    // reorder the wire cannot express.
    const queuedCreate = indexOfCreate(frames, 'user_message', QUEUED_PROMPT);
    const runningAnswer = indexOfCreate(frames, 'agent_message', RUNNING_ANSWER);
    expect(runningAnswer, 'the running turn must produce its answer item').toBeGreaterThanOrEqual(0);
    expect(queuedCreate, 'the queued prompt must reach the transcript').toBeGreaterThanOrEqual(0);
    expect(queuedCreate).toBeGreaterThan(runningAnswer);
    expect(queuedCreate).toBeGreaterThan(queuedSnapshotIndex);

    // The dequeue closes the queue: the last snapshot is empty.
    const snapshots = queueSnapshots(frames);
    expect(refContents(snapshots[snapshots.length - 1])).toEqual([]);
  });
});

test.describe('§facade-queued-prompt (UI)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'queued-prompt', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('the queued prompt is the last user message and sits below the running turn output after its dequeue', async () => {
    test.setTimeout(90_000);
    const { page } = app;
    const thread = chatThread(page);

    await sendMessage(page, RUNNING_PROMPT);
    await sendMessage(page, QUEUED_PROMPT);

    await expect(page.getByText(QUEUED_ANSWER, { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);

    await expect(thread.userMessages()).toHaveCount(2);
    await expect(thread.userMessages().last()).toContainText(QUEUED_PROMPT);

    // Geometry, not just ordering in the DOM query: the dequeued prompt renders
    // BELOW the answer of the turn it waited on.
    const runningAnswerBox = await thread.assistantMessages().filter({ hasText: RUNNING_ANSWER }).boundingBox();
    const queuedPromptBox = await thread.userMessages().filter({ hasText: QUEUED_PROMPT }).boundingBox();
    expect(runningAnswerBox, 'the running turn answer must be mounted').not.toBeNull();
    expect(queuedPromptBox, 'the dequeued prompt must be mounted').not.toBeNull();
    expect(queuedPromptBox!.y).toBeGreaterThan(runningAnswerBox!.y);
  });
});
