/**
 * §stress-matrix — the ADR combined stress run (ADR 2026-06-05-chat-runtime-decision.md
 * "Prototype scope: must stress, not just demo"), reworked for the ACP facade (todo #350):
 * sends ride `session/prompt` on `/acp/{profile}` and reconnect convergence is
 * `session/resume` replay — the buffered `message.send` + subscribe:ack re-seed premise
 * died with the legacy chat dialect (spec decision 24).
 *
 * ONE chat, ONE flow: long chat → nested subagent + mid-turn permission (with a WS drop
 * while the gate is pending — resume redelivers it) → reconnect mid-stream (resume replay
 * converges the transcript without duplicating items) → a send while the facade is DOWN
 * fails visibly and retry delivers it exactly once.
 *
 * Drop lever: helpers/tauri/ws-control.ts (page.routeWebSocket proxy) — severs BOTH daemon
 * sockets (side-band `/` and facade `/acp/*`); `holdDown()` additionally refuses new
 * connections for a deterministic down window. The daemon stays alive across drops, so
 * both clients auto-reconnect and the facade's gap listener triggers `session/resume`.
 *
 * Deliberately NOT asserted: daemon-restart permission replies ("stream closed", Post-V1).
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle, waitConnected } from '../helpers/tauri/wait.js';
import { chatThread, composer } from '../helpers/tauri/page-objects.js';
import { installWsControl, type WsControl } from '../helpers/tauri/ws-control.js';

async function waitForFacadeReconnect(page: Page, ws: WsControl, prevFacadeCount: number): Promise<void> {
  // 30s, not 15: AcpFacadeClient backs off 1s→15s, and a hold-down window burns the
  // early retries — after release() the next attempt can be a full backoff step away.
  await expect
    .poll(() => ws.facadeConnectionCount(), { timeout: 30_000, message: 'the facade client should auto-reconnect' })
    .toBeGreaterThan(prevFacadeCount);
  await waitConnected(page);
}

test.describe('§ADR stress matrix — combined run', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let ws: WsControl;
  let messagesFetches = 0;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'stress-matrix' });
    ws = await installWsControl(app.page);
    // Count REST history reads (GET /api/chats/:id/messages) for the no-refetch assertion.
    app.page.on('request', (req) => {
      if (req.method() === 'GET' && /\/api\/chats\/[^/]+\/messages/.test(req.url())) messagesFetches += 1;
    });
    // The sockets predate the route — recreate them through the proxy.
    await app.page.reload();
    await waitConnected(app.page);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('long chat → subagent + mid-turn permission → reconnect mid-stream → offline send fails then retries once', async () => {
    test.setTimeout(240_000);
    const { page } = app;
    const thread = chatThread(page);

    // ── Phase 1: long-chat base + live-echo dedup (checklist 8, 15 baseline) ──
    for (const [i, reply] of [
      ['1', 'Reply one'],
      ['2', 'Reply two'],
      ['3', 'Reply three'],
    ] as const) {
      await sendMessage(page, `Stress turn ${i}`);
      await expect(page.getByText(reply, { exact: false })).toBeVisible({ timeout: 30_000 });
      await waitForIdle(page);
      // Optimistic pending reconciled against the transcript echo: exactly one user bubble per send.
      await expect(thread.userMessages().filter({ hasText: `Stress turn ${i}` })).toHaveCount(1);
    }
    await expect(thread.userMessages()).toHaveCount(3);
    await expect(thread.assistantMessages()).toHaveCount(3);

    // ── Phase 2: nested subagent + MID-TURN permission (checklist 5, 6) ──
    await sendMessage(page, 'Delegate the greeting search to a subagent');
    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    // Gate survives a WS drop while pending (checklist 7): the post-reconnect
    // `session/resume` redelivers the still-open gate under the same correlation id.
    const before = ws.facadeConnectionCount();
    ws.drop();
    await waitForFacadeReconnect(page, ws, before);
    await expect(gate).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="chat-permission-option-allow-once"]').click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('SUBAGENT-DONE', { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);

    // Nested transcript renders: expand the Task card, nested Bash card inside.
    const taskCard = page.getByTestId('chat-task-card').first();
    await expect(taskCard).toBeVisible();
    await taskCard.getByTestId('chat-task-toggle').click();
    await expect(taskCard.getByTestId('chat-bash-card').first()).toBeVisible({ timeout: 10_000 });
    // Exactly one gate was mounted for the whole turn (no duplicate permission part).
    await expect(page.locator('[data-testid="chat-permission-gate"]')).toHaveCount(0);

    // ── Phase 3: reconnect MID-STREAM (checklist 1, 2, 12, 13, 14) ──
    // Leave the Task card OPEN, then park a composer draft AFTER the send (sendMessage fills
    // and submits, which clears the input) — the mid-stream draft must survive the replay.
    await sendMessage(page, 'Stream a long twelve-part answer');
    await composer(page).type('draft that must survive the re-seed');
    await expect(page.getByText('Stream chunk 3 of 12', { exact: false })).toBeVisible({ timeout: 30_000 });

    // Scroll up so we are NOT at-bottom, then sever mid-stream.
    const viewport = page.locator('[data-testid="chat-thread-viewport"]');
    await viewport.evaluate((el) => {
      el.scrollTop = 0;
    });
    const midStream = ws.facadeConnectionCount();
    ws.drop();
    await waitForFacadeReconnect(page, ws, midStream);

    // Convergence: the facade's gap listener resumes from the last settled item; the
    // replay upserts the streaming item at its CURRENT content (full frame, same stable
    // id — resume.rs), so every chunk lands exactly once and nothing duplicates.
    await expect(page.getByText('STREAM-COMPLETE', { exact: false })).toBeVisible({ timeout: 45_000 });
    await waitForIdle(page);
    // The twelve lines render as ONE markdown paragraph (soft line breaks), so
    // no element's exact text is a single line — count substring occurrences
    // in the streamed message instead: each chunk exactly once, no loss, no
    // duplication.
    const streamedText = await thread.assistantMessages().filter({ hasText: 'STREAM-COMPLETE' }).innerText();
    for (let k = 1; k <= 12; k++) {
      const chunk = `Stream chunk ${k} of 12`;
      const occurrences = streamedText.split(chunk).length - 1;
      expect(occurrences, `"${chunk}" must appear exactly once after the mid-stream resume`).toBe(1);
    }
    // No duplicated earlier content either (accumulator upserts keyed by stable item id).
    await expect(page.getByText('SUBAGENT-DONE', { exact: false })).toHaveCount(1);
    await expect(thread.userMessages().filter({ hasText: 'Stream a long twelve-part answer' })).toHaveCount(1);

    // Wholesale-replacement tolerance (the ADR's flagged must-validate risk — the projection
    // still replaces the message list per transcript update):
    // (12) open tool card is still open, (14) composer draft intact, (13) not yanked to bottom.
    await expect(taskCard.getByTestId('chat-bash-card').first()).toBeVisible();
    await expect(composer(page).input()).toHaveValue('draft that must survive the re-seed');
    const stuckToBottom = await viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
    expect(stuckToBottom, 'reconnect replay must not yank a scrolled-up viewport to the bottom').toBe(false);

    // ── Phase 4: send while the facade is DOWN (checklist 8, 9, 10, reworked) ──
    // `session/prompt` is a request against the live connection — with the socket held
    // down it fails fast (no legacy client-side buffering), the optimistic bubble flips
    // to a visible "failed" state, and retry after reconnect delivers it exactly once
    // (the failed send never reached the daemon, so the recording's next interaction is
    // still the retry's to consume).
    await composer(page).input().fill(''); // clear the surviving draft
    ws.holdDown();
    await sendMessage(page, 'Dedup probe message');
    const probe = thread.userMessages().filter({ hasText: 'Dedup probe message' });
    await expect(probe).toHaveCount(1);
    await expect(page.getByTestId('chat-user-message-send-failed')).toBeVisible({ timeout: 15_000 });

    const preRelease = ws.facadeConnectionCount();
    ws.release();
    await waitForFacadeReconnect(page, ws, preRelease);
    await page.getByTestId('chat-user-message-retry').click();
    await expect(page.getByText('DEDUP-ACK', { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);
    await expect(probe).toHaveCount(1);

    // ── Final ledger: full-transcript integrity + no REST history refetch (checklist 1, 15) ──
    // 6 top-level sends. The subagent's prompt also renders as a `chat-user-message` — but
    // NESTED inside the Task card (part of the subagent transcript), so it is excluded here
    // and asserted in its place explicitly.
    await expect(page.locator('[data-testid="chat-user-message"]:not([data-testid="chat-task-card"] *)')).toHaveCount(
      6,
    );
    await expect(taskCard.locator('[data-testid="chat-user-message"]')).toHaveCount(1);
    for (const text of ['Reply one', 'Reply two', 'Reply three', 'SUBAGENT-DONE', 'STREAM-COMPLETE', 'DEDUP-ACK']) {
      await expect(page.getByText(text, { exact: false })).toHaveCount(1);
    }
    // The four legacy re-seed paths collapsed into resume replay: history never rides
    // GET /api/chats/:id/messages on the facade path, drops or not.
    expect(messagesFetches, 'history must ride session/resume, never a REST refetch').toBe(0);
  });
});
