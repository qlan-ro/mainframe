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
import { openSocket, sendJson, collectUntilQuiet, closeSocket } from '../helpers/tauri/raw-ws-client.js';
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

  // ── dual-surface: same chat on a legacy client and a facade client ─────────
  //
  // Blocked: the facade socket loop (mainframe-server/src/acp_ws.rs) dispatches only
  // `initialize` and the heartbeat ticker — `session/prompt`/`session/new`/
  // `session/request_permission` are unwired (mainframe-acp/src/connection.rs's
  // `handle_frame_with_prompt` has zero callers outside its own crate; see
  // acp_ws_integration.rs:111-127, which pins `session/prompt` -> method-not-found on the
  // LIVE route today). No group in the plan's file list owns wiring prompt/resume/gates
  // into the socket, so a gate cannot be raised or answered on the facade at all yet.
  // Un-skip once that wiring lands; this test's shape (answer on legacy, assert resolution
  // reaches a facade `session/update` for the same gate id) is otherwise ready to fill in.
  test('gate answered on the legacy surface resolves consistently on the facade', async () => {
    test.skip(true, 'TODO(#350): facade session/prompt + gates are unwired on the live socket — see comment above');
  });
});
