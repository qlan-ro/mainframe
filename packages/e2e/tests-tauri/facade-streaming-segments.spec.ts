/**
 * §facade-streaming-segments — long-chat and streaming plan G-final
 * (`docs/plans/2026-10-01-long-chat-and-streaming.md`), spec Decisions 37–40.
 *
 * The `text-tool-text-stream` recording streams a text partial under the API
 * message id `msg_S`, commits it with a `Read` tool use, returns the tool
 * result, streams a second text partial, commits it, and ends the turn.
 * `mockMaxDelayMs` widens the mock's 120ms replay clamp so every partial and
 * commit lands in its own 100ms facade throttle window. Otherwise the
 * `streaming` create would merge into the commit and never reach the wire.
 *
 * Harness note: the mock adapter cannot attach a vendor id to `onMessage`
 * (`MessageMetadata.vendor_id` is `#[serde(skip)]`), so a committed message gets
 * a minted id rather than `msg_S`. The overlay item `msg_S` is therefore cleared
 * at the commit, and the turn's container is the minted id `C`. With the Claude
 * adapter `C === msg_S`. The assertions below hold either way: they key the
 * segment order off the tool call's own `containerId`, and they check the final
 * live item list, not a hardcoded id list.
 *
 *   - wire half (raw `/acp/{profile}` socket): every item's first frame, and only
 *     that frame, carries `created: true` (D37); each overlay-backed create
 *     carries `streaming: true` and a later frame for that item drops it (D39);
 *     the surviving items are `C`, the Read call, `C-1` (D40); a resume from
 *     `start` replays that same list and closes with `replay_complete` right
 *     after `queue_state` (D38).
 *   - UI half: one assistant message renders text, the Read card, then text.
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

/** Wide enough that the recording's 300 / 800 / 1200 / 1600 / 2200ms marks stay distinct. */
const MOCK_MAX_DELAY_MS = 3_000;
const PROMPT = 'Read index.ts, then tell me what it exports';
const READ_TOOL_ID = 'toolu_e2e_stream_read';
const OVERLAY_ID = 'msg_S';
const SEGMENT_ONE = 'SEGMENT-ONE: reading index.ts first.';
const SEGMENT_TWO = 'SEGMENT-TWO: the file exports one greeting constant.';

const MESSAGE_UPDATES = ['agent_message', 'user_message', 'agent_thought'];

/** A message upsert whose content is the empty list: the client deletes the item (T23). */
function isClear(frame: SessionUpdateFrame): boolean {
  const update = frame.params?.update;
  return (
    MESSAGE_UPDATES.includes(update?.sessionUpdate ?? '') &&
    Array.isArray(update?.content) &&
    update.content.length === 0
  );
}

/** Item ids alive after applying `frames` in order: created on `created`, removed on a clear. */
function liveItemIds(frames: SessionUpdateFrame[]): string[] {
  const alive: string[] = [];
  for (const frame of frames) {
    const id = itemId(frame);
    if (id === undefined) continue;
    if (isClear(frame)) {
      if (alive.includes(id)) alive.splice(alive.indexOf(id), 1);
    } else if (mainframeMeta(frame)?.created === true && !alive.includes(id)) alive.push(id);
  }
  return alive;
}

test.describe('§facade-streaming-segments (wire)', () => {
  let handle: DaemonHandle;
  let project: HeadlessProject;
  let chatId: string;
  /** Captured by the live test, compared against the resume replay. */
  let liveIds: string[] = [];

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'text-tool-text-stream', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    project = await createHeadlessProject();
    chatId = await createHeadlessChat(project.projectId);
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
    cleanupHeadlessProject(project);
  });

  test('creation markers, streaming status and text segments around a tool call', async () => {
    const ws = await connectAndInitialize();
    sendJson(ws, promptRequest(2, chatId, PROMPT));
    const frames = updates(await collectUntilQuiet(ws, 1_800, 30_000));
    await closeSocket(ws);

    // D37: an item's first frame carries `created: true`, and no other frame does.
    const seen = new Set<string>();
    for (const frame of frames) {
      const id = itemId(frame);
      if (id === undefined) continue;
      const created = mainframeMeta(frame)?.created === true;
      expect(created, `${frame.params?.update?.sessionUpdate} for ${id}: created only on the first frame`).toBe(
        !seen.has(id),
      );
      seen.add(id);
    }

    // D39: the overlay item is created as streaming, and so is the second text
    // segment. Each loses the flag on a later frame (a meta change, or a clear).
    const streamingCreates = frames.filter((f) => mainframeMeta(f)?.streaming === true);
    expect(streamingCreates.map(itemId)).toContain(OVERLAY_ID);
    for (const create of streamingCreates) {
      const id = itemId(create)!;
      expect(mainframeMeta(create)?.created, `${id}: streaming rides the create`).toBe(true);
      const later = frames.slice(frames.indexOf(create) + 1).filter((f) => itemId(f) === id);
      const dropped = later.find((f) => isClear(f) || (mainframeMeta(f) !== undefined && !mainframeMeta(f)?.streaming));
      expect(dropped, `${id}: a later frame must drop streaming`).toBeDefined();
    }

    // D40: the Read call closes the first text segment and the second text
    // opens `{container}-1`. The container is the tool call's own containerId.
    const toolCreate = frames.find((f) => itemId(f) === READ_TOOL_ID && mainframeMeta(f)?.created === true);
    expect(toolCreate?.params?.update?.title).toBe('Read');
    const container = mainframeMeta(toolCreate!)?.containerId;
    expect(container, 'the Read call names its container').toBeTruthy();

    // The prompt's own user item leads; the assistant items follow in source order.
    liveIds = liveItemIds(frames);
    const userCreate = frames.find((f) => f.params?.update?.sessionUpdate === 'user_message');
    expect(liveIds[0]).toBe(itemId(userCreate!));
    expect(liveIds.slice(1)).toEqual([container, READ_TOOL_ID, `${container}-1`]);
    expect(streamingCreates.map(itemId)).toContain(`${container}-1`);
  });

  test('a resume from start replays the same items and closes with replay_complete after queue_state', async () => {
    expect(liveIds.length, 'the live test must have captured the turn').toBe(4);
    const ws = await connectAndInitialize();
    const collected = collectUntilQuiet(ws, 1_500, 15_000);
    const replies = collectFrames(ws);
    sendJson(ws, resumeRequest(2, chatId, { type: 'start' }));
    const reply = await replies.next((f) => f['id'] === 2);
    expect(reply['error']).toBeUndefined();
    const frames = await collected;
    await closeSocket(ws);

    expectReplayClosedAfterQueueState(frames, chatId, 2);

    // A replay creates every item once, marked, with nothing left streaming on an idle chat.
    const replayed = updates(frames).filter((f) => itemId(f) !== undefined);
    expect(replayed.map(itemId)).toEqual(liveIds);
    for (const frame of replayed) {
      expect(mainframeMeta(frame)?.created, `${itemId(frame)} replays as a create`).toBe(true);
      expect(mainframeMeta(frame)?.streaming, `${itemId(frame)} is not streaming after the turn`).toBeUndefined();
    }
  });
});

test.describe('§facade-streaming-segments (UI)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'text-tool-text-stream', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('one assistant message renders the text, the Read card, then the final text', async () => {
    const { page } = app;
    const thread = chatThread(page);
    await sendMessage(page, PROMPT);

    await expect(page.getByText(SEGMENT_TWO, { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);
    await expect(page.getByText(SEGMENT_TWO, { exact: false })).toBeVisible();

    await expect(thread.assistantMessages()).toHaveCount(1);
    const message = thread.assistantMessages();
    const firstText = message.getByText(SEGMENT_ONE, { exact: true });
    const readCard = message.getByTestId('read-card-root');
    const lastText = message.getByText(SEGMENT_TWO, { exact: true });
    await expect(firstText).toHaveCount(1);
    await expect(readCard).toHaveCount(1);
    await expect(lastText).toHaveCount(1);
    await expect(readCard.getByText('Read', { exact: true })).toBeVisible();

    // Source order, by geometry: text above the card, the card above the final text.
    const [firstBox, cardBox, lastBox] = await Promise.all([
      firstText.boundingBox(),
      readCard.boundingBox(),
      lastText.boundingBox(),
    ]);
    expect(firstBox && cardBox && lastBox, 'all three parts must be laid out').toBeTruthy();
    expect(firstBox!.y).toBeLessThan(cardBox!.y);
    expect(cardBox!.y).toBeLessThan(lastBox!.y);
  });
});
