/**
 * §stress-matrix — the ADR combined stress run (MIGRATION-TRACKER :357; ADR
 * 2026-06-05-chat-runtime-decision.md "Prototype scope: must stress, not just demo").
 *
 * ONE chat, ONE flow: long chat → nested subagent + mid-turn permission (with a WS drop
 * while the gate is pending) → reconnect mid-stream → optimistic send + echo dedup with a
 * WS drop before the send (buffered message.send + reconcile via history re-seed).
 *
 * Drop lever: helpers/tauri/ws-control.ts (page.routeWebSocket proxy). The daemon stays
 * alive across drops — only the socket is severed, so ws-client auto-reconnects and the
 * subscribe:ack handler re-seeds history (chat-ws-subscription.ts).
 *
 * Deliberately NOT asserted: chat-plan-running-footer (known bug, gates.spec.ts:242);
 * daemon-restart permission replies ("stream closed", Post-V1).
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle, waitConnected } from '../helpers/tauri/wait.js';
import { chatThread, composer } from '../helpers/tauri/page-objects.js';
import { installWsControl, type WsControl } from '../helpers/tauri/ws-control.js';

async function waitForReconnect(page: Page, ws: WsControl, prevCount: number): Promise<void> {
  await expect
    .poll(() => ws.connectionCount(), { timeout: 15_000, message: 'ws-client should auto-reconnect' })
    .toBeGreaterThan(prevCount);
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
    // Count history re-seeds (GET /api/chats/:id/messages) for the bounded-refetch assertion.
    app.page.on('request', (req) => {
      if (req.method() === 'GET' && /\/api\/chats\/[^/]+\/messages/.test(req.url())) messagesFetches += 1;
    });
    // The socket predates the route — recreate it through the proxy.
    await app.page.reload();
    await waitConnected(app.page);
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('long chat → subagent + mid-turn permission → reconnect mid-stream → optimistic dedup', async () => {
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
      // Optimistic pending reconciled against the live echo: exactly one user bubble per send.
      await expect(thread.userMessages().filter({ hasText: `Stress turn ${i}` })).toHaveCount(1);
    }
    await expect(thread.userMessages()).toHaveCount(3);
    await expect(thread.assistantMessages()).toHaveCount(3);

    // ── Phase 2: nested subagent + MID-TURN permission (checklist 5, 6) ──
    await sendMessage(page, 'Delegate the greeting search to a subagent');
    const gate = page.locator('[data-testid="chat-permission-gate"]');
    await gate.waitFor({ timeout: 45_000 });

    // Gate survives a WS drop while pending (checklist 7): restore via GET /pending-permission.
    const before = ws.connectionCount();
    ws.drop();
    await waitForReconnect(page, ws, before);
    await expect(gate).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="chat-permission-allow-once"]').click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('SUBAGENT-DONE', { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);

    // Nested transcript renders (WS14c): expand the Task card, nested Bash card inside.
    const taskCard = page.getByTestId('chat-task-card').first();
    await expect(taskCard).toBeVisible();
    await taskCard.getByTestId('chat-task-toggle').click();
    await expect(taskCard.getByTestId('chat-bash-card').first()).toBeVisible({ timeout: 10_000 });
    // Exactly one gate was mounted for the whole turn (no duplicate permission part).
    await expect(page.locator('[data-testid="chat-permission-gate"]')).toHaveCount(0);

    // ── Phase 3: reconnect MID-STREAM (checklist 1, 2, 12, 13, 14) ──
    // Leave the Task card OPEN, then park a composer draft AFTER the send (sendMessage fills
    // and submits, which clears the input) — the mid-stream draft must survive the re-seed.
    await sendMessage(page, 'Stream a long twelve-part answer');
    await composer(page).type('draft that must survive the re-seed');
    await expect(page.getByText('Stream chunk 3 of 12', { exact: false })).toBeVisible({ timeout: 30_000 });

    // Scroll up so we are NOT at-bottom, then sever mid-stream.
    const viewport = page.locator('[data-testid="chat-thread-viewport"]');
    await viewport.evaluate((el) => {
      el.scrollTop = 0;
    });
    const midStream = ws.connectionCount();
    ws.drop();
    await waitForReconnect(page, ws, midStream);

    // Convergence: the re-seed delivers the chunks missed while disconnected — every chunk
    // exactly once, plus the completion marker (drift-free, "IDs intact").
    await expect(page.getByText('STREAM-COMPLETE', { exact: false })).toBeVisible({ timeout: 45_000 });
    await waitForIdle(page);
    for (let k = 1; k <= 12; k++) {
      await expect(page.getByText(`Stream chunk ${k} of 12`, { exact: true })).toHaveCount(1);
    }
    // No duplicated earlier content either (wholesale replace keyed by id, not appended).
    await expect(page.getByText('SUBAGENT-DONE', { exact: false })).toHaveCount(1);
    await expect(thread.userMessages().filter({ hasText: 'Stream a long twelve-part answer' })).toHaveCount(1);

    // Wholesale-replacement tolerance (the ADR's flagged must-validate risk):
    // (12) open tool card is still open, (14) composer draft intact, (13) not yanked to bottom.
    await expect(taskCard.getByTestId('chat-bash-card').first()).toBeVisible();
    await expect(composer(page).input()).toHaveValue('draft that must survive the re-seed');
    const stuckToBottom = await viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
    expect(stuckToBottom, 'reconnect re-seed must not yank a scrolled-up viewport to the bottom').toBe(false);

    // ── Phase 4: optimistic send + echo dedup THROUGH a reconnect (checklist 8, 9, 10) ──
    // Sever first; the send is buffered by ws-client (never dropped), the optimistic bubble
    // renders immediately, and the echo arrives via the reconnect history re-seed — the
    // history-path reconcile (reconcilePendingAgainstHistory) must clear the pending: 1 bubble.
    await composer(page).input().fill(''); // clear the surviving draft
    const preSend = ws.connectionCount();
    ws.drop();
    await sendMessage(page, 'Dedup probe message');
    await expect(thread.userMessages().filter({ hasText: 'Dedup probe message' })).toHaveCount(1);
    await waitForReconnect(page, ws, preSend);
    await expect(page.getByText('DEDUP-ACK', { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);
    await expect(thread.userMessages().filter({ hasText: 'Dedup probe message' })).toHaveCount(1);

    // ── Final ledger: full-transcript integrity + bounded re-seeds (checklist 1, 15) ──
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
    // 3 drops → 3 reconnect re-seeds (+ initial load + first-send pendings refresh headroom).
    // A refetch storm (delta-path regression) would blow well past this.
    expect(messagesFetches, `history refetch count (${messagesFetches}) should be bounded`).toBeLessThanOrEqual(10);
  });
});
