/**
 * §plan gate clear-context — PR #688 review-fix verification scenario 2
 * ("plan-mode clear context empties the transcript and it stays empty", plan
 * `docs/plans/2026-09-14-pr-688-review-fixes-plan.md` Verification step 7).
 *
 * Approving a plan with "Clear context" kills the session, wipes the message
 * cache, pushes `_mainframe.dev/transcript_cleared`, restarts the chat, and
 * auto-sends "Implement the following plan:". T24's blocker was the client side:
 * `reattach()` did not reset the accumulator, and the empty-refresh guard refused
 * an `itemCount: 0` replay, so the wiped transcript came straight back on the next
 * resume. This drives the real gate and checks both halves — the wire wipe and
 * that the UI stays wiped across a further send.
 *
 * `plan-clear.0.ndjson` stops at the open ExitPlanMode gate (no recorded
 * `respondToPermission`); the post-clear restart is a new session, so it consumes
 * `plan-clear.1.ndjson` — which is why nothing else in this file may create a
 * session against this daemon.
 */
import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { chatThread } from '../helpers/tauri/page-objects.js';
import { sendJson, collectFrames, collectUntilQuiet, closeSocket } from '../helpers/tauri/raw-ws-client.js';
import { resumeRequest, updates, connectAndInitialize } from '../helpers/tauri/facade-protocol-support.js';

const PLAN_MODE_CLAUDE_MD =
  '# E2E Test Project\n\nThis is an automated test environment.\n' +
  'In plan mode, proceed with reasonable assumptions. Do not use AskUserQuestion. ' +
  'Call ExitPlanMode immediately after reading the relevant files.\n';

const PROMPT = 'PRE-CLEAR-PROMPT: sketch a greeting helper';
const PRE_CLEAR_ANSWER = 'PRE-CLEAR-ANSWER: read utils.ts before planning.';
const POST_CLEAR_ANSWER = 'POST-CLEAR-ANSWER: implemented the approved plan.';
const FOLLOW_UP = 'Anything else worth doing?';
const FOLLOW_UP_ANSWER = 'AFTER-CLEAR-ANSWER: nothing older came back.';

/** Every text block of every replayed message/thought item, flattened. */
function replayText(frames: unknown[]): string {
  return updates(frames)
    .map((frame) => JSON.stringify(frame.params?.update?.content ?? ''))
    .join('\n');
}

test.describe('§plan gate clear-context', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'plan-clear' });
    project = await createTauriProject(app.page, { claudeMd: PLAN_MODE_CLAUDE_MD });
    chatId = await createTauriChat(app.page, project.projectId, 'plan');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('approving with clear context wipes the transcript on the wire and in the UI, and a later send does not bring it back', async () => {
    test.setTimeout(120_000);
    const { page } = app;
    const thread = chatThread(page);

    await sendMessage(page, PROMPT);
    await expect(page.getByText(PRE_CLEAR_ANSWER, { exact: false })).toBeVisible({ timeout: 45_000 });
    await page.locator('[data-testid="chat-plan-gate"]').waitFor({ timeout: 45_000 });

    // A second, raw facade connection attached to the same chat, so the wipe
    // notification and the post-wipe replay can be read straight off the wire.
    // It only resumes, so it consumes no recording marker.
    const raw = await connectAndInitialize();
    const rawFrames = collectFrames(raw);
    sendJson(raw, resumeRequest(2, chatId));
    await rawFrames.next((f) => f['id'] === 2);

    await page.locator('[data-testid="chat-plan-clear-context"]').click();
    await expect(page.locator('[data-testid="chat-plan-clear-context"]')).toHaveAttribute('data-state', 'checked');
    await page.locator('[data-testid="chat-plan-approve"]').click();

    // Wire half: the server announces the wipe, and the replay it triggers holds
    // none of the pre-approval turn.
    const cleared = await rawFrames.next((f) => f['method'] === '_mainframe.dev/transcript_cleared', 45_000);
    expect((cleared['params'] as { sessionId?: string }).sessionId).toBe(chatId);

    await expect(page.getByText(POST_CLEAR_ANSWER, { exact: false })).toBeVisible({ timeout: 45_000 });
    await waitForIdle(page);

    sendJson(raw, resumeRequest(3, chatId, { type: 'start' }));
    const replay = await collectUntilQuiet(raw, 1_500, 20_000);
    await closeSocket(raw);
    const replayed = replayText(replay);
    expect(replayed).not.toContain(PRE_CLEAR_ANSWER);
    expect(replayed).not.toContain(PROMPT);
    expect(replayed).toContain(POST_CLEAR_ANSWER);

    // UI half: the pre-approval turn is gone and the restart's auto-sent turn is
    // what the thread now holds. That turn is asserted through its ANSWER, not a
    // user bubble. TODO(bug): the auto-sent "Implement the following plan:" prompt
    // gets enrolled in `queuedRefs` — the chat is still `Working`, because the
    // pre-approval turn is killed mid-flight and never produces an `onResult` —
    // and `mock-cli` replays a uuid-carrying prompt without ever calling
    // `on_queued_processed`, so the ref is never retired, the encoder keeps
    // dropping the message (D1), and every later send stacks behind it as
    // "Queued · Nth in line". The real CLI's replay ack retires the ref, so this
    // is a mock-fidelity gap in `mainframe-adapter-mock/src/session_trait.rs`,
    // not a façade defect — but it is why no user bubble is asserted here.
    await expect(thread.assistantMessages().filter({ hasText: PRE_CLEAR_ANSWER })).toHaveCount(0);
    await expect(thread.userMessages().filter({ hasText: PROMPT })).toHaveCount(0);
    await expect(thread.assistantMessages().filter({ hasText: POST_CLEAR_ANSWER })).toHaveCount(1);

    // …and it stays gone: one more send must not resurrect the wiped turn (T24 —
    // a `reattach()` that kept the accumulator replayed it straight back).
    await sendMessage(page, FOLLOW_UP);
    await expect(page.getByText(FOLLOW_UP_ANSWER, { exact: false })).toBeVisible({ timeout: 45_000 });
    await waitForIdle(page);
    await expect(thread.assistantMessages().filter({ hasText: PRE_CLEAR_ANSWER })).toHaveCount(0);
    await expect(thread.userMessages().filter({ hasText: PROMPT })).toHaveCount(0);
    await expect(thread.userMessages().filter({ hasText: FOLLOW_UP })).toHaveCount(1);
  });
});
