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
 *
 * The streaming describe (criteria 3, 4, 5, 9, 11 client-half) moved to
 * `facade-protocol-streaming.spec.ts` (todo #350, plan task 37, R2.13) — this file kept the
 * handshake, gates, and retry describes. Both files share their request builders and frame
 * helpers via `helpers/tauri/facade-protocol-support.ts`.
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
import {
  PROFILE,
  initializeRequest,
  promptRequest,
  resumeRequest,
  updates,
  itemId,
  connectAndInitialize,
  type SessionUpdateFrame,
} from '../helpers/tauri/facade-protocol-support.js';

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

  // Two refusals, not one: the negotiation gate (spec decision 32) answers every
  // method but `initialize` before the dispatcher ever sees the frame, so an
  // unknown method is method-not-found only AFTER a completed handshake. Both
  // halves are pinned here — asserting the post-handshake code alone would pass
  // just as well against a daemon that had lost the gate.
  test('criterion 2: an unknown method is refused as initialize-required before the handshake, and method-not-found after it', async () => {
    const ws = await openSocket(`/acp/${PROFILE}`);

    // Pre-handshake: the structured refusal from `connection.rs::initialize_required`.
    sendJson(ws, { jsonrpc: '2.0', id: 1, method: 'not/a/real/method', params: {} });
    const gated = (await nextJsonMessage(ws)) as { error?: { code?: number; message?: string } };
    expect(gated.error?.code).toBe(-32002);
    expect(gated.error?.message).toBe('initialize required');

    sendJson(ws, initializeRequest(2));
    const okReply = (await nextJsonMessage(ws)) as { result?: unknown };
    expect(okReply.result).toBeDefined();

    // Post-handshake: the same frame reaches the dispatcher, which names the
    // offending method back.
    sendJson(ws, { jsonrpc: '2.0', id: 3, method: 'not/a/real/method', params: {} });
    const reply = (await nextJsonMessage(ws)) as { error?: { code?: number; message?: string } };
    await closeSocket(ws);
    expect(reply.error?.code).toBe(-32601);
    expect(reply.error?.message).toContain('not/a/real/method');
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
