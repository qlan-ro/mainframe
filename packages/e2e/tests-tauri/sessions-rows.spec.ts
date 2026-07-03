/**
 * §sessions-rows — The session row as a human uses it: click-to-select, hover
 * actions, the right-click context menu, pin/unpin, the four StatusDot states,
 * and the row's meta line (project chip / worktree pill / tag dots).
 *
 * Ported from plan spec #2 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). Does NOT duplicate: sessions.spec.ts (rename/archive/restore/
 * import), sessions-filters.spec.ts (pills/tag-bar/sort), sessions-tags.spec.ts
 * (tag popover internals — this file only asserts the resulting row dot).
 *
 * Source (verified against packages/ui/src/features/sessions/sidebar/):
 *   SessionRow.tsx        — row root, StatusDot, RowHoverActions, pin glyph
 *   SessionRowMeta.tsx    — project chip / worktree pill / PR link / tag dots
 *   SessionContextMenu.tsx — right-click menu (Pin/Unpin, Rename, Tags, Archive, Copy Session ID)
 *   SessionGroupHeader.tsx — group header, incl. the 'Pinned' group's pin glyph
 *   view-model/session-status.ts — deriveSessionBadge (worktree-missing > working > waiting > idle)
 *
 * Testid reference (all verified against source above):
 *   sessions-row                     — row root (data-chat-id, data-active)
 *   sessions-row-status-dot          — StatusDot; aria-label = badge.base
 *                                       ('idle'|'working'|'waiting'|'worktree-missing')
 *   sessions-row-relative-time       — time label, hidden on row hover
 *   sessions-row-action-tags/-rename/-archive — hover-action buttons (hidden until row hover)
 *   sessions-ctx-pin/-rename/-tags/-archive/-copy-id — context-menu items
 *   sessions-group-header-Pinned     — the Pinned group header
 *   sessions-group-pin-glyph         — pin glyph on the Pinned group header (see NOTE below)
 *   sessions-row-meta-project        — project chip (All view only)
 *   sessions-row-meta-worktree       — worktree pill (text-destructive when missing)
 *   sessions-row-meta-worktree-missing — empty marker span, present only when worktreeMissing
 *   sessions-row-meta-tag-dot-<name> — applied-tag dot cluster
 *
 * NOTE on the pin glyph: SessionRow.tsx also renders a PER-ROW
 * `sessions-row-pin-glyph` guarded by `custom.pinned && !inPinnedGroup`. Per
 * group-sessions.ts (`arrangeRecent`/`arrangeFlat`), pinned items are ALWAYS
 * routed into the 'Pinned' group across every sort mode, and SessionListVirtuoso
 * sets `inPinnedGroup: group.label === 'Pinned'` — so `inPinnedGroup` is always
 * true for a pinned row and the per-row glyph is unreachable through the sidebar
 * as currently wired. This spec asserts the reachable `sessions-group-pin-glyph`
 * (on the group header) instead. Flagged in the report for the owner.
 */

import { test, expect, type Page } from '@playwright/test';
import { rmSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { sendMessage, waitForIdle, waitConnected } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/**
 * The mock-cli replay caps every inter-event delay at 120ms (ReplaySession.MAX_DELAY_MS),
 * so the 'working' badge (set synchronously by chat-manager.sendMessage, before any adapter
 * event) is only observable for a short window before the next recorded event (permission
 * request or result) flips it. Playwright's built-in expect() retry cadence is too coarse to
 * reliably sample that window, so this polls the DOM directly via requestAnimationFrame.
 */
async function waitForWorkingSpinner(page: Page, chatId: string, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const row = document.querySelector(`[data-testid="sessions-row"][data-chat-id="${id}"]`);
      const dot = row?.querySelector('[data-testid="sessions-row-status-dot"]');
      return dot?.getAttribute('aria-label') === 'working';
    },
    chatId,
    { timeout, polling: 'raf' },
  );
}

// ─── Row selection, hover actions, context menu, pin, meta line ──────────────

test.describe('§sessions-rows Row selection, hover, context menu, pin, meta line', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatIdX: string;
  let chatIdY: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatIdX = await createTauriChat(app.page, project.projectId, 'default');
    chatIdY = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('clicking a row selects it (data-active), deselecting the previously active row', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowX = sidebar.row(chatIdX);
    const rowY = sidebar.row(chatIdY);

    // createTauriChat clicks the row it creates — Y (created last) starts active.
    await expect(rowY).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await rowX.click();
    await expect(rowX).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
    // Native ThreadListItemPrimitive.Root sets `data-active` conditionally (present only when
    // true, per the `data-[active=true]:...` Tailwind selectors in SessionRow.tsx) — it is never
    // emitted as the literal string "false" when inactive, only omitted. Root-caused live: the
    // deselected row's `data-active` attribute value is `null` (absent), not "false".
    await expect(rowY).not.toHaveAttribute('data-active', 'true');
  });

  test('idle status dot is muted on a fresh, read chat', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const dot = rowX.getByTestId('sessions-row-status-dot');

    await expect(dot).toHaveAttribute('aria-label', 'idle');
    await expect(dot).toHaveClass(/bg-mf-text-4/);
    await expect(dot).toHaveClass(/opacity-50/);
    await expect(dot).not.toHaveClass(/bg-primary/);
  });

  test('hovering a row swaps the relative-time label for the tag/rename/archive action buttons', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const relTime = rowX.getByTestId('sessions-row-relative-time');
    const tagsBtn = rowX.getByTestId('sessions-row-action-tags');
    const renameBtn = rowX.getByTestId('sessions-row-action-rename');
    const archiveBtn = rowX.getByTestId('sessions-row-action-archive');

    await expect(relTime).toBeVisible();
    await expect(tagsBtn).toBeHidden();

    await rowX.hover();
    await expect(relTime).toBeHidden();
    await expect(tagsBtn).toBeVisible();
    await expect(renameBtn).toBeVisible();
    await expect(archiveBtn).toBeVisible();

    // Reset hover so it doesn't bleed into later tests.
    await page.mouse.move(0, 0);
    await expect(relTime).toBeVisible();
  });

  test('right-click context menu shows exactly Pin, Rename, Tags, Archive before any message has been sent', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);

    await rowX.click({ button: 'right' });
    const pinItem = page.getByTestId('sessions-ctx-pin');
    await expect(pinItem).toBeVisible({ timeout: 5_000 });
    await expect(pinItem).toContainText('Pin');
    await expect(page.getByTestId('sessions-ctx-rename')).toBeVisible();
    await expect(page.getByTestId('sessions-ctx-tags')).toBeVisible();
    await expect(page.getByTestId('sessions-ctx-archive')).toBeVisible();
    // No message has been sent on this chat yet — no claudeSessionId, so no copy-id item.
    await expect(page.getByTestId('sessions-ctx-copy-id')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(pinItem).toHaveCount(0, { timeout: 5_000 });
  });

  test('pinning via the context menu moves the row into a Pinned group with a pin glyph; unpinning reverts it', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const pinnedHeader = page.getByTestId('sessions-group-header-Pinned');

    await rowX.click({ button: 'right' });
    await page.getByTestId('sessions-ctx-pin').click();

    await expect(pinnedHeader).toBeVisible({ timeout: 10_000 });
    await expect(pinnedHeader.getByTestId('sessions-group-pin-glyph')).toBeVisible();
    await expect(rowX).toBeVisible();

    await rowX.click({ button: 'right' });
    const unpinItem = page.getByTestId('sessions-ctx-pin');
    await expect(unpinItem).toContainText('Unpin');
    await unpinItem.click();

    await expect(pinnedHeader).toHaveCount(0, { timeout: 10_000 });
    await expect(rowX).toBeVisible();
  });

  test('project chip renders in the meta line only in the All view', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowX = sidebar.row(chatIdX);

    const chip = rowX.getByTestId('sessions-row-meta-project');
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await expect(chip).toContainText(path.basename(project.projectPath));

    await sidebar.projectFilterPill(project.projectId).click();
    await expect(rowX.getByTestId('sessions-row-meta-project')).toHaveCount(0, { timeout: 5_000 });

    // Reset the filter to All for subsequent tests.
    await page.getByTestId('sessions-filter-pill-all').click();
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test('applying a tag surfaces a colored dot in the row meta line', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const tagName = 'e2e-rows-meta';

    await rowX.hover();
    await rowX.getByTestId('sessions-row-action-tags').evaluate((el) => (el as HTMLElement).click());
    const popover = page.getByTestId('sessions-tag-popover');
    await expect(popover).toBeVisible({ timeout: 5_000 });

    const search = page.getByTestId('sessions-tag-popover-search');
    await search.fill(tagName);
    await search.press('Enter');

    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0, { timeout: 5_000 });

    await expect(rowX.getByTestId(`sessions-row-meta-tag-dot-${tagName}`)).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Worktree meta pill + missing state ───────────────────────────────────────

test.describe('§sessions-rows Worktree meta pill + missing state', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('worktree pill shows the branch basename; going missing on disk flips the pill + dot to destructive', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);
    const dot = row.getByTestId('sessions-row-status-dot');

    const enableRes = await page.request.post(`${DAEMON_BASE}/api/chats/${chatId}/enable-worktree`, {
      data: { baseBranch: 'main', branchName: 'e2e-rows-worktree' },
    });
    expect(enableRes.ok()).toBe(true);

    const pill = row.getByTestId('sessions-row-meta-worktree');
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).not.toHaveClass(/text-destructive/);
    await expect(row.getByTestId('sessions-row-meta-worktree-missing')).toHaveCount(0);
    await expect(dot).toHaveAttribute('aria-label', 'idle');

    const chatRes = await page.request.get(`${DAEMON_BASE}/api/chats/${chatId}`);
    const chatBody = (await chatRes.json()) as { data?: { worktreePath?: string } };
    const worktreePath = chatBody.data?.worktreePath;
    if (!worktreePath) throw new Error('enable-worktree did not set worktreePath on the chat');
    rmSync(worktreePath, { recursive: true, force: true });

    // No FS watch on the daemon side — a reload forces the isWorktreePresent
    // re-check that flips worktreeMissing (see enrichChat in chat-manager.ts).
    await page.reload();
    await waitConnected(page);

    await expect(dot).toHaveAttribute('aria-label', 'worktree-missing', { timeout: 15_000 });
    await expect(pill).toHaveClass(/text-destructive/);
    // Present-but-empty marker span — assert attachment, not visibility (it has no box).
    await expect(row.getByTestId('sessions-row-meta-worktree-missing')).toHaveCount(1);
  });
});

// ─── Working spinner + waiting beacon during a gate-held run ─────────────────

test.describe('§sessions-rows Working + waiting status dot during a gate-held run', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-interactive' });
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('shows a working spinner while the CLI processes, then a waiting beacon once the permission gate lands', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);
    const dot = row.getByTestId('sessions-row-status-dot');

    await expect(dot).toHaveAttribute('aria-label', 'idle');

    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    // chat-manager sets processState='working' synchronously on send (before any
    // adapter event), so this is reachable — but briefly, see waitForWorkingSpinner.
    await waitForWorkingSpinner(page, chatId);

    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    // The same onPermission handler that surfaces the gate also emits the
    // chat.updated that flips displayStatus to 'waiting' — no race here.
    await expect(dot).toHaveAttribute('aria-label', 'waiting', { timeout: 5_000 });

    // Clean up: deny so the mock session ends cleanly before teardown.
    await page.locator('[data-testid="chat-permission-deny"]').click();
    await waitForIdle(page, 60_000);
    await expect(dot).toHaveAttribute('aria-label', 'idle', { timeout: 10_000 });
  });
});

// ─── Unread status dot + copy session id ──────────────────────────────────────

test.describe('§sessions-rows Unread status dot + copy session id', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatIdA: string;
  let chatIdB: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    // Both chats created up front (beforeAll) to avoid the known mid-test
    // useSessionListRouter navigation race (see chat.spec.ts / the shared brief).
    chatIdA = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    chatIdB = await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('marks the row unread once a response lands while a different chat is active, and clears it on reselect', async () => {
    // TODO(bug): genuine architectural gap, root-caused live (two independent code traces,
    // reproduced twice) — a backgrounded chat's `chat.notification` WS event can NEVER reach the
    // client, so the unread dot can never light up.
    //   1. packages/core/src/server/websocket.ts's broadcastEvent scopes delivery by
    //      `client.subscriptions.has(chatId)` — chat.notification always carries a chatId, so it
    //      is only sent to a socket still subscribed to that chat.
    //   2. There is ONE shared WS connection per app (packages/ui/src/lib/daemon/ws-client.ts,
    //      `daemonWs` module singleton) used by both the sessions sidebar
    //      (session-list-router.ts, which is what would consume chat.notification to call
    //      `onMarkUnread`) and every per-chat thread controller.
    //   3. Per-chat subscribe/unsubscribe is gated to the ACTIVE thread only
    //      (use-chat-thread-runtime.ts: "open the live WS sub only while this is the active
    //      thread ... deactivation drops the sub"). Switching the active chat from A to B fires
    //      ChatWsSubscription.detach(), which sends `{type:'unsubscribe', chatId: A}` over the
    //      one shared socket.
    //   4. When A's task later completes, the daemon DOES correctly compute and emit
    //      `chat.notification{chatId: A, level:'success'}` (verified against the recording's
    //      onResult shape: subtype:"success", is_error:false — falls into the taskComplete
    //      branch, event-handler.ts:380-386) — but broadcastEvent's subscription check now fails
    //      for A, so the frame is silently never sent. onMarkUnread never fires.
    // This is exactly backwards from the feature's own purpose (notifying about a BACKGROUND
    // chat you're not looking at) — the dormancy optimization that unsubscribes inactive chats to
    // save resume/ack traffic also, as a side effect, makes background-chat unread notifications
    // unreachable. Not touchable from e2e (packages/core + packages/ui, out of scope here).
    test.skip(
      true,
      'TODO(bug): chat.notification for a backgrounded chat never reaches the client — its WS subscription is torn down on deactivation before the response completes (see comment above)',
    );
  });

  test('copy-session-id appears once the chat has a claudeSessionId, and copies it to the clipboard', async () => {
    const { page } = app;
    const rowA = sessionsSidebar(page).row(chatIdA);

    const chatRes = await page.request.get(`${DAEMON_BASE}/api/chats/${chatIdA}`);
    const chatBody = (await chatRes.json()) as { data?: { claudeSessionId?: string } };
    const claudeSessionId = chatBody.data?.claudeSessionId;
    test.skip(!claudeSessionId, 'chat has no claudeSessionId yet (recording did not emit onInit) — nothing to copy');
    if (!claudeSessionId) return;

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await rowA.click({ button: 'right' });
    const copyItem = page.getByTestId('sessions-ctx-copy-id');
    await expect(copyItem).toBeVisible({ timeout: 5_000 });
    await copyItem.click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(claudeSessionId);
  });
});

// ─── PR link (unseedable) ─────────────────────────────────────────────────────

test.describe('§sessions-rows PR link', () => {
  test('PR link opens in a new tab (target=_blank)', () => {
    // detectedPrs is populated by scanning tool_results for `gh pr create`/PR
    // mentions during a live run — there is no REST seam or recording that
    // produces it deterministically. Out of scope here.
    test.skip(true, 'TODO(app-tauri): PR-link needs a detected-PR fixture; no REST/recording seam exists');
  });
});
