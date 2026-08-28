/**
 * §legacy-freeze — todo #350 task 24, criterion 12's e2e form.
 *
 * The legacy `/` WS dialect (`DaemonEvent`/`ClientEvent`, mainframe-types/src/events.rs)
 * must stay byte-compatible while the ACP facade (`/acp/{profile}`) is built alongside it —
 * mobile (a separate repo) depends on the frozen shape until it migrates. This spec captures
 * one recorded mock-adapter turn's legacy chat frames, masks nondeterministic fields (ids,
 * timestamps, the e2e temp project path), and diffs the result against a committed baseline.
 *
 * Backstops group B's unit-level shape guard (plan task 4, `mainframe-chat`) at the transport
 * boundary: this is a real WS connection to a real spawned daemon, not an in-process capture.
 *
 * CAVEAT (plan decision 5): the committed baseline was captured on this branch, after groups
 * A-G's changes — none of which touch the legacy emit paths (fact 9: `mainframe-chat` never
 * depended on `mainframe-adapter-claude`/the facade crate; group B's task 5/6 changed live/
 * history id *derivation*, not frame shape, and this spec's mask already treats ids as
 * opaque). Group B's task-4 characterization test is the actual pre-change oracle; this spec
 * freezes forward from here so no later group in THIS todo can silently change legacy shape.
 *
 * Regenerate deliberately: `MF_E2E_UPDATE_BASELINE=1 playwright test legacy-freeze.spec.ts`.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startDaemon, stopDaemon, type DaemonHandle } from '../fixtures/daemon.js';
import { createHeadlessProject, createHeadlessChat, cleanupHeadlessProject } from '../helpers/tauri/headless-chat.js';
import { openSocket, sendJson, collectUntilQuiet, closeSocket, collectFrames } from '../helpers/tauri/raw-ws-client.js';
import { normalizeFrames } from '../helpers/tauri/normalize-frame.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.resolve(__dirname, '../fixtures/legacy-freeze-baseline.json');
const CHAT_EVENT_TYPES = new Set([
  'subscribe:ack',
  'display.messages.set',
  'display.message.added',
  'display.message.updated',
  'messages.cleared',
  'message.added',
  'message.updated',
]);

test.describe('§legacy-freeze', () => {
  let handle: DaemonHandle;

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'compaction' });
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
  });

  test('legacy chat frame shapes match the committed baseline', async () => {
    const project = await createHeadlessProject();
    const chatId = await createHeadlessChat(project.projectId);

    const ws = await openSocket('/');
    sendJson(ws, { type: 'subscribe', chatId });
    sendJson(ws, { type: 'message.send', chatId, content: 'Summarize our conversation so far and keep going' });

    const raw = await collectUntilQuiet(ws, 700, 15_000);
    await closeSocket(ws);
    cleanupHeadlessProject(project);

    const chatFrames = raw.filter((frame): frame is { type: string; chatId?: string } => {
      const f = frame as { type?: unknown; chatId?: unknown };
      return (
        typeof f.type === 'string' && CHAT_EVENT_TYPES.has(f.type) && (f.chatId === undefined || f.chatId === chatId)
      );
    });
    expect(chatFrames.length, 'the recorded turn must have produced at least one chat frame').toBeGreaterThan(0);

    const masked = normalizeFrames(chatFrames);

    if (process.env['MF_E2E_UPDATE_BASELINE'] === '1') {
      writeFileSync(BASELINE_PATH, JSON.stringify(masked, null, 2) + '\n');
      return;
    }
    if (!existsSync(BASELINE_PATH)) {
      throw new Error(
        `No baseline at ${BASELINE_PATH}. Generate it: MF_E2E_UPDATE_BASELINE=1 playwright test legacy-freeze.spec.ts`,
      );
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(masked).toEqual(baseline);
  });
});

// Dual-surface (todo #350 task 24's second half): same chat on a legacy client
// and a facade client during the migration window. Its own daemon — the gate
// flow needs the `permissions-interactive` recording, and a fresh chat on the
// baseline describe's daemon would consume a `compaction.1.ndjson` that does
// not exist.
test.describe('§legacy-freeze dual-surface', () => {
  let handle: DaemonHandle;

  test.beforeAll(async () => {
    handle = await startDaemon({ recordingKey: 'permissions-interactive' });
  });

  test.afterAll(async () => {
    await stopDaemon(handle);
  });

  // The migration-window guarantee: a gate raised mid-turn reaches both
  // surfaces, an answer on the LEGACY surface resolves it for the facade too
  // (one chat-surface observer — `FacadeHub` — behind both), and the turn
  // then completes on the facade rather than hanging on a phantom gate.
  test('gate answered on the legacy surface resolves consistently on the facade', async () => {
    test.setTimeout(60_000);
    const project = await createHeadlessProject();
    // The recording's first prompt opens a Write gate and waits at the answer.
    const chatId = await createHeadlessChat(project.projectId);

    // Both sockets need buffering readers from the start: the gate lands on
    // both surfaces near-simultaneously, so a per-await listener would drop
    // whichever side's frame arrived while the test awaited the other.
    const legacy = await openSocket('/');
    const legacyFrames = collectFrames(legacy);
    sendJson(legacy, { type: 'subscribe', chatId });
    const facade = await openSocket('/acp/mock-cli');
    const facadeFrames = collectFrames(facade);
    sendJson(facade, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 2, info: { name: 'mainframe-e2e', version: '0.0.0' } },
    });
    await facadeFrames.next((f) => f['id'] === 1);

    sendJson(facade, {
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: {
        sessionId: chatId,
        prompt: [{ type: 'text', text: 'Create a file at /tmp/mf-e2e-test.txt with content "hello"' }],
      },
    });

    // The gate must reach both surfaces.
    const facadeGate = await facadeFrames.next((f) => f['method'] === 'session/request_permission');
    const legacyGate = await legacyFrames.next((f) => f['type'] === 'permission.requested');
    const request = legacyGate['request'] as {
      requestId: string;
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    };
    expect(facadeGate['id']).toBe(`gate-${request.requestId}`);

    // Answer on the legacy surface (the recording's deny), then the facade
    // must see the turn proceed to its end — not hang on the open gate.
    sendJson(legacy, {
      type: 'permission.respond',
      chatId,
      response: {
        requestId: request.requestId,
        toolUseId: request.toolUseId,
        toolName: request.toolName,
        behavior: 'deny',
        updatedInput: request.input,
      },
    });
    const idle = await facadeFrames.next((f) => {
      const update = (f['params'] as { update?: { sessionUpdate?: string; state?: string } } | undefined)?.update;
      return update?.sessionUpdate === 'state_update' && update.state === 'idle';
    });
    expect(idle).toBeDefined();

    await closeSocket(facade);
    await closeSocket(legacy);
    cleanupHeadlessProject(project);
  });
});
