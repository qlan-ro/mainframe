/**
 * §facade-protocol — todo #350 task 23, the ACP facade e2e suite.
 *
 * Connects directly to `/acp/{profile}` over a raw WS client (no browser `page` — these are
 * protocol invariants, not DOM behaviors) against a real spawned daemon in E2E_MODE=mock.
 * The live route dispatches the full facade: `session/prompt`/`session/cancel` through the
 * `ChatManager` prompt port, `session/resume` replay with stream seeding, and permission
 * gates (`mainframe-server/src/acp_ws/`).
 *
 * One daemon per describe: the mock adapter replays `E2E_RECORDING_KEY` per spawned session
 * and each fresh chat consumes the next fixture index (`{key}.{n}.ndjson`), so criteria that
 * need different recordings get their own daemon, and tests inside a describe share one
 * chat's single recording in order.
 */
import { test, expect } from '@playwright/test';
import { startDaemon, stopDaemon, type DaemonHandle } from '../fixtures/daemon.js';
import {
  createHeadlessProject,
  createHeadlessChat,
  cleanupHeadlessProject,
  type HeadlessProject,
} from '../helpers/tauri/headless-chat.js';
import {
  openSocket,
  sendJson,
  nextJsonMessage,
  collectUntilQuiet,
  collectFrames,
  closeSocket,
} from '../helpers/tauri/raw-ws-client.js';

const PROFILE = 'mock-cli';

interface SessionUpdateFrame {
  method?: string;
  id?: unknown;
  params?: {
    sessionId?: string;
    update?: {
      sessionUpdate?: string;
      messageId?: string;
      toolCallId?: string;
      content?: unknown;
      rawInput?: unknown;
      _meta?: Record<string, { attempt?: number; reason?: string }>;
    };
  };
}

function initializeRequest(id: number) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: 2, info: { name: 'mainframe-e2e', version: '0.0.0' } },
  };
}

function promptRequest(id: number, sessionId: string, text: string) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text }] },
  };
}

function resumeRequest(id: number, sessionId: string, replayFrom?: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/resume',
    params: { sessionId, cwd: '/tmp', ...(replayFrom !== undefined ? { replayFrom } : {}) },
  };
}

function updates(frames: unknown[]): SessionUpdateFrame[] {
  return (frames as SessionUpdateFrame[]).filter((f) => f.method === 'session/update');
}

function itemId(frame: SessionUpdateFrame): string | undefined {
  return frame.params?.update?.messageId ?? frame.params?.update?.toolCallId;
}

function itemIds(frames: SessionUpdateFrame[]): Set<string> {
  return new Set(frames.map(itemId).filter((id): id is string => id !== undefined));
}

async function connectAndInitialize(id = 1): Promise<WebSocket> {
  const ws = await openSocket(`/acp/${PROFILE}`);
  sendJson(ws, initializeRequest(id));
  await nextJsonMessage(ws);
  return ws;
}

test.describe('§facade-protocol handshake', () => {
  let handle: DaemonHandle;

  test.beforeAll(async () => {
    handle = await startDaemon({});
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
  });

  // ── criterion 1: version handshake, both branches ───────────────────────────

  test('criterion 1: initialize at the pinned version returns capabilities', async () => {
    const ws = await openSocket(`/acp/${PROFILE}`);
    sendJson(ws, initializeRequest(1));
    const reply = (await nextJsonMessage(ws)) as { result?: { protocolVersion?: number } };
    await closeSocket(ws);

    expect(reply.result?.protocolVersion).toBe(2);
  });

  test('criterion 1: an unsupported version gets a structured error, connection stays open', async () => {
    const ws = await openSocket(`/acp/${PROFILE}`);
    sendJson(ws, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 99, info: { name: 'mainframe-e2e', version: '0.0.0' } },
    });
    const errorReply = (await nextJsonMessage(ws)) as { error?: { code?: number; data?: { supported?: number[] } } };
    expect(errorReply.error?.code).toBe(-32001);
    expect(errorReply.error?.data?.supported).toEqual([2]);

    sendJson(ws, initializeRequest(2));
    const okReply = (await nextJsonMessage(ws)) as { result?: unknown };
    await closeSocket(ws);
    expect(okReply.result).toBeDefined();
  });

  // ── criterion 2: malformed frame + unknown method, connection stays open ────

  test('criterion 2: a malformed frame gets a parse error, connection stays open', async () => {
    const ws = await openSocket(`/acp/${PROFILE}`);
    ws.send('{not json');
    const errorReply = (await nextJsonMessage(ws)) as { error?: { code?: number } };
    expect(errorReply.error?.code).toBe(-32700);

    sendJson(ws, initializeRequest(1));
    const okReply = (await nextJsonMessage(ws)) as { result?: unknown };
    await closeSocket(ws);
    expect(okReply.result).toBeDefined();
  });

  test('criterion 2: an unadvertised method gets method-not-found', async () => {
    const ws = await openSocket(`/acp/${PROFILE}`);
    sendJson(ws, { jsonrpc: '2.0', id: 1, method: 'not/a/real/method', params: {} });
    const reply = (await nextJsonMessage(ws)) as { error?: { code?: number } };
    await closeSocket(ws);
    expect(reply.error?.code).toBe(-32601);
  });

  // ── criterion 11, daemon half: heartbeat arrives at the advertised cadence ──

  test('criterion 11 (daemon half): a heartbeat notification arrives after connect', async () => {
    test.setTimeout(30_000);
    const ws = await openSocket(`/acp/${PROFILE}`);
    sendJson(ws, initializeRequest(1));
    const initReply = (await nextJsonMessage(ws)) as {
      result?: { _meta?: { '_mainframe.dev'?: { heartbeatIntervalMs?: number } } };
    };
    const advertisedMs = initReply.result?._meta?.['_mainframe.dev']?.heartbeatIntervalMs;
    expect(advertisedMs).toBeGreaterThan(0);

    // Production cadence (15s) — no test-only knob exists on the spawned daemon binary
    // (`TestServerOptions.facade_heartbeat_interval_ms` is an in-process Rust test seam only).
    // One real wait here is the honest e2e proof; keeping it to a single heartbeat bounds cost.
    const heartbeat = (await nextJsonMessage(ws, (advertisedMs ?? 15_000) + 5_000)) as {
      method?: string;
      params?: { sequence?: number };
    };
    await closeSocket(ws);
    expect(heartbeat.method).toBe('_mainframe.dev/heartbeat');
    expect(heartbeat.params?.sequence).toBe(1);
  });
});

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
    // notification method is from the facade vocabulary.
    const allowedMethods = [
      'session/update',
      'session/request_permission',
      '_mainframe.dev/heartbeat',
      '_mainframe.dev/gate_resolved',
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

test.describe('§facade-protocol gates', () => {
  let handle: DaemonHandle;
  let project: HeadlessProject;
  let chatId: string;

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'permissions-interactive' });
    project = await createHeadlessProject();
    chatId = await createHeadlessChat(project.projectId);
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
    cleanupHeadlessProject(project);
  });

  test('criterion 9: session/resume redelivers an open permission gate', async () => {
    test.setTimeout(45_000);
    const ws = await openSocket(`/acp/${PROFILE}`);
    const frames = collectFrames(ws);
    sendJson(ws, initializeRequest(1));
    await frames.next((f) => f['id'] === 1);
    sendJson(ws, promptRequest(2, chatId, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"'));

    // The recording stops at an open Write gate; wait for its live delivery.
    const liveGate = (await frames.next((f) => f['method'] === 'session/request_permission')) as SessionUpdateFrame;
    expect(liveGate.params?.sessionId).toBe(chatId);

    // The client "reconnects": a second connection resumes and must get the
    // still-open gate redelivered under the same correlation id, after the
    // item replay.
    const ws2 = await connectAndInitialize();
    sendJson(ws2, resumeRequest(2, chatId));
    const replayFrames = await collectUntilQuiet(ws2, 1_500, 15_000);
    await closeSocket(ws);
    await closeSocket(ws2);

    const redelivered = (replayFrames as SessionUpdateFrame[]).find((f) => f.method === 'session/request_permission');
    expect(redelivered, 'resume must redeliver the open gate').toBeDefined();
    expect(redelivered?.id).toEqual(liveGate?.id);
    expect(updates(replayFrames).length).toBeGreaterThan(0);
  });
});

test.describe('§facade-protocol retry', () => {
  let handle: DaemonHandle;
  let project: HeadlessProject;
  let chatId: string;

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'retry' });
    project = await createHeadlessProject();
    chatId = await createHeadlessChat(project.projectId);
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
    cleanupHeadlessProject(project);
  });

  test('criterion 7: a replayed api_retry surfaces as a retry-marked patch, not a duplicate item', async () => {
    const ws = await connectAndInitialize();
    sendJson(ws, promptRequest(2, chatId, 'Trigger a retry then finish'));
    const frames = updates(await collectUntilQuiet(ws, 1_500, 20_000));
    await closeSocket(ws);

    // The daemon no longer drops api_retry: the marker rides the next
    // content-carrying upsert's namespaced _meta (spec decision 10).
    const marked = frames.find((f) => f.params?.update?._meta?.['_mainframe.dev']?.attempt !== undefined);
    expect(marked, 'a retry marker must appear on the stream').toBeDefined();
    expect(marked?.params?.update?._meta?.['_mainframe.dev']?.attempt).toBe(1);
    expect(marked?.params?.update?._meta?.['_mainframe.dev']?.reason).toBe('overloaded_error');

    // No duplicated items: content-carrying upserts stay unique per item.
    const contentUpserts = new Map<string, number>();
    for (const frame of frames) {
      const update = frame.params?.update;
      const id = itemId(frame);
      if (update === undefined || id === undefined) continue;
      if (['agent_message', 'user_message', 'agent_thought'].includes(update.sessionUpdate ?? '') && update.content) {
        contentUpserts.set(id, (contentUpserts.get(id) ?? 0) + 1);
      }
    }
    for (const [id, count] of contentUpserts) {
      expect(count, `item ${id} must appear once, not duplicated`).toBe(1);
    }
  });
});
