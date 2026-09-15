/**
 * §facade-reconnect mid-stream — PR #688 review-fix verification scenario 6
 * ("a reconnect mid-turn resumes with the tail message still streaming", plan
 * `docs/plans/2026-09-14-pr-688-review-fixes-plan.md` Verification step 7).
 *
 * `stress-matrix.spec.ts` already drops the socket mid-stream and checks the
 * transcript converges; what it cannot check is the run state the resume reports,
 * because its recording bursts through twelve chunks in well under the reconnect
 * backoff. The `reconnect-mid-stream` recording spaces the same twelve chunks one
 * second apart (with `mockMaxDelayMs` widening the mock's 120ms clamp), leaving a
 * ~13s turn that is unambiguously still running while the client reconnects.
 *
 * Two observations on one daemon and one chat:
 *   - wire: a second, raw `/acp/{profile}` connection resumes mid-turn. The first
 *     `state_update` the replay produces is `running` (`resume.rs::
 *     turn_state_update`) — a client that reconnects mid-turn must not be told the
 *     session is idle. The raw socket only resumes, so it consumes no recording
 *     marker and cannot perturb the turn the app is driving.
 *   - UI: after the app's own facade socket is severed and reconnects, the running
 *     indicator is still up and the tail bubble keeps growing to the sentinel, with
 *     every chunk landing exactly once.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle, waitConnected } from '../helpers/tauri/wait.js';
import { chatThread } from '../helpers/tauri/page-objects.js';
import { installWsControl, type WsControl } from '../helpers/tauri/ws-control.js';
import { sendJson, collectFrames, closeSocket } from '../helpers/tauri/raw-ws-client.js';
import { resumeRequest, connectAndInitialize } from '../helpers/tauri/facade-protocol-support.js';

/** Wide enough that the recording's 1s-apart chunk marks survive the clamp. */
const MOCK_MAX_DELAY_MS = 15_000;
const PROMPT = 'Stream a long twelve-part answer';
const SENTINEL = 'STREAM-COMPLETE: all twelve chunks delivered.';

/** Mirrors stress-matrix.spec.ts's reconnect wait (AcpFacadeClient backs off 1s→15s). */
async function waitForFacadeReconnect(page: Page, ws: WsControl, prevFacadeCount: number): Promise<void> {
  await expect
    .poll(() => ws.facadeConnectionCount(), { timeout: 30_000, message: 'the facade client should auto-reconnect' })
    .toBeGreaterThan(prevFacadeCount);
  await waitConnected(page);
}

test.describe('§facade-reconnect mid-stream', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let ws: WsControl;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'reconnect-mid-stream', mockMaxDelayMs: MOCK_MAX_DELAY_MS });
    ws = await installWsControl(app.page);
    // The sockets predate the route — recreate them through the proxy.
    await app.page.reload();
    await waitConnected(app.page);
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('a mid-turn resume reports the session running, and the tail keeps streaming across the reconnect', async () => {
    test.setTimeout(120_000);
    const { page } = app;
    const thread = chatThread(page);
    await sendMessage(page, PROMPT);
    await expect(page.getByText('Stream chunk 3 of 12', { exact: false })).toBeVisible({ timeout: 30_000 });

    // ── Wire half: a reconnecting client's resume, taken mid-turn ──
    const raw = await connectAndInitialize();
    const frames = collectFrames(raw);
    sendJson(raw, resumeRequest(2, chatId));
    const reply = await frames.next((f) => f['id'] === 2);
    expect(reply['error']).toBeUndefined();

    // The replay's trailing state transition. Anything already streaming must
    // come back as `running` — an `idle` here is the regression (the client
    // would drop its running indicator and stop smoothing the tail).
    const stateFrame = await frames.next(
      (f) =>
        f['method'] === 'session/update' &&
        (f['params'] as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === 'state_update',
    );
    const state = (stateFrame['params'] as { update?: { state?: string } }).update?.state;
    expect(state).toBe('running');
    await closeSocket(raw);

    // ── UI half: sever the app's own sockets mid-stream ──
    const beforeDrop = ws.facadeConnectionCount();
    ws.drop();
    await waitForFacadeReconnect(page, ws, beforeDrop);

    // The turn did not end with the socket: the running indicator is still up
    // after the resume, and the tail bubble keeps growing to the sentinel.
    await expect(page.getByTestId('chat-thread-running')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SENTINEL, { exact: false })).toBeVisible({ timeout: 40_000 });
    await waitForIdle(page);

    // One growing bubble, not a duplicate per resume: the twelve chunks render
    // as one markdown paragraph, so count substring occurrences inside it.
    const streamed = thread.assistantMessages().filter({ hasText: SENTINEL });
    await expect(streamed).toHaveCount(1);
    const streamedText = await streamed.innerText();
    for (let k = 1; k <= 12; k++) {
      const chunk = `Stream chunk ${k} of 12`;
      const occurrences = streamedText.split(chunk).length - 1;
      expect(occurrences, `"${chunk}" must appear exactly once after the mid-stream resume`).toBe(1);
    }
    await expect(thread.userMessages().filter({ hasText: PROMPT })).toHaveCount(1);
  });
});
