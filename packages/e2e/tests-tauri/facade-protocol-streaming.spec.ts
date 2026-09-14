/**
 * §facade-protocol streaming — todo #350 task 23, the ACP facade e2e suite.
 *
 * Criteria 3, 4, 5, 9 (unknown cursor), and 11 (client half): chunk/patch-only streaming, a
 * mid-turn prompt's acceptance, stable item ids between the live stream and `session/resume`,
 * and resume-after-silence convergence. Split out of `facade-protocol.spec.ts` (todo #350,
 * plan task 37, R2.13) — see that file's module doc for the shared harness this describe
 * still follows (one daemon, `E2E_MODE=mock`, no browser `page`).
 */
import { test, expect } from '@playwright/test';
import { startDaemon, stopDaemon, type DaemonHandle } from '../fixtures/daemon.js';
import {
  createHeadlessProject,
  createHeadlessChat,
  cleanupHeadlessProject,
  type HeadlessProject,
} from '../helpers/tauri/headless-chat.js';
import { sendJson, nextJsonMessage, collectUntilQuiet, closeSocket } from '../helpers/tauri/raw-ws-client.js';
import {
  promptRequest,
  resumeRequest,
  updates,
  itemId,
  itemIds,
  connectAndInitialize,
  type SessionUpdateFrame,
} from '../helpers/tauri/facade-protocol-support.js';

test.describe('§facade-protocol streaming', () => {
  let handle: DaemonHandle;
  let project: HeadlessProject;
  let chatId: string;
  /** Frames captured by the criterion-3/5 test, reused by the resume tests. */
  let liveFrames: SessionUpdateFrame[] = [];

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'messaging' });
    project = await createHeadlessProject();
    chatId = await createHeadlessChat(project.projectId);
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
    cleanupHeadlessProject(project);
  });

  test('criteria 3 + 5: chunk/patch-only streaming, prompt-during-turn, no queue.* frames', async () => {
    const ws = await connectAndInitialize();

    sendJson(ws, promptRequest(2, chatId, 'What is 2 + 2? Reply with just the number.'));
    const first = (await nextJsonMessage(ws)) as { id?: number; result?: unknown; error?: unknown };
    expect(first.error).toBeUndefined();

    // Criterion 5: a prompt sent while the first turn is replaying is accepted
    // immediately (a result, not an error) — acceptance is distinct from
    // turn completion.
    sendJson(ws, promptRequest(3, chatId, 'List the files in this project using bash ls.'));
    const frames = (await collectUntilQuiet(ws, 1_500, 25_000)) as SessionUpdateFrame[];
    await closeSocket(ws);

    const promptReply = frames.find((f) => (f as { id?: number }).id === 3) as
      { result?: unknown; error?: unknown } | undefined;
    expect(promptReply, 'the mid-turn prompt must get a reply').toBeDefined();
    expect(promptReply?.error).toBeUndefined();

    // Criterion 5: no queue.* frame family exists on the facade — every
    // notification method is from the facade vocabulary. The mid-turn prompt
    // above is what makes `_mainframe.dev/queue_state` appear here (spec
    // decision 24). Whether that snapshot is non-empty depends on whether the
    // prompt lands inside the `messaging` recording's ~120ms turn-1 window, so
    // this test only pins the method vocabulary; the queued snapshot's CONTENT
    // and the dequeue's tail ordering are pinned deterministically in
    // `facade-queued-prompt.spec.ts`, whose recording parks turn 1 for 3s.
    const allowedMethods = [
      'session/update',
      'session/request_permission',
      '_mainframe.dev/heartbeat',
      '_mainframe.dev/gate_resolved',
      '_mainframe.dev/queue_state',
      '_mainframe.dev/compaction',
      '_mainframe.dev/transcript_cleared',
    ];
    for (const frame of frames) {
      if (frame.method !== undefined) expect(allowedMethods).toContain(frame.method);
    }

    liveFrames = updates(frames);
    expect(liveFrames.length).toBeGreaterThan(0);

    // Criterion 3: after an item's first frame no later frame repeats its full
    // accumulated content — per message id at most ONE content-carrying
    // upsert, and per tool call at most one frame re-stating rawInput
    // (omitted = unchanged in the patch grammar).
    const contentUpserts = new Map<string, number>();
    const rawInputFrames = new Map<string, number>();
    for (const frame of liveFrames) {
      const update = frame.params?.update;
      const id = itemId(frame);
      if (update === undefined || id === undefined) continue;
      if (['agent_message', 'user_message', 'agent_thought'].includes(update.sessionUpdate ?? '') && update.content) {
        contentUpserts.set(id, (contentUpserts.get(id) ?? 0) + 1);
      }
      if (update.sessionUpdate === 'tool_call_update' && update.rawInput !== undefined) {
        rawInputFrames.set(id, (rawInputFrames.get(id) ?? 0) + 1);
      }
    }
    for (const [id, count] of contentUpserts) {
      expect(count, `message ${id} must not re-send full content`).toBe(1);
    }
    for (const [id, count] of rawInputFrames) {
      expect(count, `tool call ${id} must not re-send rawInput`).toBe(1);
    }
  });

  test('criterion 4: item ids are stable between the live stream and session/resume', async () => {
    const ws = await connectAndInitialize();
    sendJson(ws, resumeRequest(2, chatId));
    const reply = (await nextJsonMessage(ws)) as { result?: unknown; error?: unknown };
    expect(reply.error).toBeUndefined();

    const replayFrames = updates(await collectUntilQuiet(ws, 1_500, 15_000));
    await closeSocket(ws);

    const liveIds = itemIds(liveFrames);
    const replayIds = itemIds(replayFrames);
    expect(liveIds.size).toBeGreaterThan(0);
    expect(replayIds).toEqual(liveIds);
  });

  test('criterion 11 (client half) + criterion 9 (unknown cursor): resume-after-silence converges', async () => {
    // A client that went silent (missed heartbeats, dropped socket) converges
    // by resuming from its last item — only post-cursor items are replayed.
    const orderedIds = [...itemIds(liveFrames)];
    expect(orderedIds.length).toBeGreaterThan(1);
    const cursorId = orderedIds[0];

    const ws = await connectAndInitialize();
    sendJson(ws, resumeRequest(2, chatId, { type: 'item', itemId: cursorId }));
    const reply = (await nextJsonMessage(ws)) as {
      result?: { _meta?: Record<string, { fullReplay?: boolean }> };
    };
    expect(reply.result?._meta?.['_mainframe.dev']?.fullReplay).toBeUndefined();

    const partialFrames = updates(await collectUntilQuiet(ws, 1_500, 15_000));
    const partialIds = itemIds(partialFrames);
    expect(partialIds.has(cursorId!)).toBe(false);
    for (const id of partialIds) expect(itemIds(liveFrames)).toContain(id);

    // Unknown cursor: full replay, flagged, no error (criterion 9's fallback).
    sendJson(ws, resumeRequest(3, chatId, { type: 'item', itemId: 'no-such-item' }));
    const fullReply = (await nextJsonMessage(ws)) as {
      result?: { _meta?: Record<string, { fullReplay?: boolean }> };
    };
    expect(fullReply.result?._meta?.['_mainframe.dev']?.fullReplay).toBe(true);
    const fullFrames = updates(await collectUntilQuiet(ws, 1_500, 15_000));
    await closeSocket(ws);
    expect(itemIds(fullFrames)).toEqual(itemIds(liveFrames));
  });
});
