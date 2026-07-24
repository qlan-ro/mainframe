/**
 * §sessions-rows — The session row as a human uses it: click-to-select, hover
 * actions, the right-click context menu, pin/unpin, the four StatusDot states,
 * and the row's compact meta glyphs + hover-card detail.
 *
 * Ported from plan spec #2 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). Does NOT duplicate: sessions.spec.ts (rename/archive/restore/
 * import), sessions-filters.spec.ts (pills/tag-bar/sort), sessions-tags.spec.ts
 * (tag popover internals — this file only asserts the resulting row dot).
 *
 * Source (verified against packages/ui/src/features/sessions/sidebar/):
 *   SessionRow.tsx          — row root, StatusDot, RowHoverActions, pin glyph
 *   SessionRowMetaIcons.tsx — compact worktree/PR/tag-dot glyph cluster (2026-07 rebuild)
 *   SessionMetaCard.tsx     — hover-card detail (project/worktree/branch/PR/tags/warning)
 *   SessionContextMenu.tsx  — right-click menu (Pin/Unpin, Rename, Tags, Archive, Copy Session ID)
 *   SessionGroupHeader.tsx  — group header, incl. the 'Pinned' group's pin glyph
 *   view-model/session-status.ts — deriveSessionBadge (worktree-missing > transcript-missing > working > waiting > idle)
 *
 * Testid reference (all verified against source above):
 *   sessions-row                     — row root (data-chat-id, data-active)
 *   sessions-row-status-dot          — StatusDot; aria-label = badge.base
 *                                       ('idle'|'working'|'waiting'|'worktree-missing'|'transcript-missing')
 *   sessions-row-relative-time       — time label, hidden on row hover
 *   sessions-row-action-pin/-tags/-archive — hover-action buttons (hidden until row hover;
 *                                       Rename is context-menu-only since the 2026-07 rebuild)
 *   sessions-ctx-pin/-rename/-tags/-archive/-copy-id — context-menu items
 *   sessions-group-header-Pinned     — the Pinned group header (plain text, no pin glyph)
 *   sessions-row-meta-icon-worktree  — compact worktree glyph on the row (text-destructive when missing)
 *   sessions-row-meta-icon-tag-dot-<name> — compact tag-dot glyph on the row (capped at 3)
 *   sessions-meta-card-project       — project row inside the hover card (All view only)
 *   sessions-meta-card-warning       — branch-safety warning inside the hover card
 *
 * NOTE on the pin glyph: SessionRow.tsx renders a PER-ROW
 * `sessions-row-pin-glyph` only when `custom.pinned && !inPinnedGroup`, and the
 * sidebar always routes pinned rows into the 'Pinned' group — so no pin glyph
 * is reachable through the sidebar (the group header is deliberately plain
 * text, see SessionGroupHeader.tsx). Pinned-ness is asserted via the group
 * header's presence.
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

    // 2026-07 sidebar rebuild: the dot is now a ProviderLogo glyph tinted by
    // state (SessionRowStatus.tsx statusLogoClass) — muted text-mf-text-3 when
    // idle+read, text-primary when unread/working/waiting.
    await expect(dot).toHaveAttribute('aria-label', 'idle');
    await expect(dot).toHaveClass(/text-mf-text-3/);
    await expect(dot).not.toHaveClass(/text-primary/);
  });

  test('hovering a row swaps the relative-time label for the pin/tag/archive action buttons', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const relTime = rowX.getByTestId('sessions-row-relative-time');
    const tagsBtn = rowX.getByTestId('sessions-row-action-tags');
    // 2026-07 sidebar rebuild: the inline Rename hover button was dropped by
    // design (the context menu owns Rename — SessionRowHoverActions.tsx) and a
    // Pin/Unpin button added as the primary pin entry point.
    const pinBtn = rowX.getByTestId('sessions-row-action-pin');
    const archiveBtn = rowX.getByTestId('sessions-row-action-archive');

    // Establish a clean non-hovered baseline first — the previous test's
    // `rowX.click()` leaves the real mouse cursor positioned over this row,
    // which keeps it in the CSS :hover state here (live-verified flake: the
    // very first assertion below saw relTime already hidden).
    await page.mouse.move(0, 0);
    await expect(relTime).toBeVisible();
    await expect(tagsBtn).toBeHidden();

    await rowX.hover();
    await expect(relTime).toBeHidden();
    await expect(tagsBtn).toBeVisible();
    await expect(pinBtn).toBeVisible();
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

  test('pinning via the context menu moves the row into a Pinned group; unpinning reverts it', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const pinnedHeader = page.getByTestId('sessions-group-header-Pinned');

    await rowX.click({ button: 'right' });
    await page.getByTestId('sessions-ctx-pin').click();

    // 2026-07 sidebar rebuild: the group header carries NO pin glyph by design
    // (plain-text section headers, macOS pattern — SessionGroupHeader.tsx); the
    // Pinned group label itself is the pinned indicator.
    await expect(pinnedHeader).toBeVisible({ timeout: 10_000 });
    await expect(rowX).toBeVisible();

    await rowX.click({ button: 'right' });
    const unpinItem = page.getByTestId('sessions-ctx-pin');
    await expect(unpinItem).toContainText('Unpin');
    await unpinItem.click();

    await expect(pinnedHeader).toHaveCount(0, { timeout: 10_000 });
    await expect(rowX).toBeVisible();
  });

  test('hover card shows the project only in the All view', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowX = sidebar.row(chatIdX);

    // 2026-07 single-row rebuild: the per-row project chip moved off the row
    // entirely (dropped from SessionRowMetaIcons per the compact-row spec) —
    // project identity is now surfaced only in the SessionMetaCard hover card,
    // and only in "All" view (same visibility rule the old inline chip had).
    await rowX.hover();
    const projectRow = page.getByTestId('sessions-meta-card-project');
    await expect(projectRow).toBeVisible({ timeout: 5_000 });
    await expect(projectRow).toContainText(path.basename(project.projectPath));

    await sidebar.projectFilterPill(project.projectId).click();
    await rowX.hover();
    await expect(page.getByTestId('sessions-meta-card-project')).toHaveCount(0, { timeout: 5_000 });

    // Reset the filter to All for subsequent tests.
    await page.getByTestId('sessions-filter-pill-all').click();
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

    await expect(rowX.getByTestId(`sessions-row-meta-icon-tag-dot-${tagName}`)).toBeVisible({ timeout: 5_000 });
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

  test('worktree glyph is present; going missing on disk flips the glyph + dot to destructive and the hover card warns', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);
    const dot = row.getByTestId('sessions-row-status-dot');

    const enableRes = await page.request.post(`${DAEMON_BASE}/api/chats/${chatId}/enable-worktree`, {
      data: { baseBranch: 'main', branchName: 'e2e-rows-worktree' },
    });
    expect(enableRes.ok()).toBe(true);

    // 2026-07 single-row rebuild: the row shows an icon-only worktree glyph
    // (SessionRowMetaIcons); the full "Worktree missing" cause text moved to
    // the SessionMetaCard hover card (no more inline text pill/degraded marker).
    const glyph = row.getByTestId('sessions-row-meta-icon-worktree');
    await expect(glyph).toBeVisible({ timeout: 15_000 });
    await expect(glyph).not.toHaveClass(/text-destructive/);
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
    await expect(glyph).toHaveClass(/text-destructive/);

    await row.hover();
    const warning = page.getByTestId('sessions-meta-card-warning');
    await expect(warning).toBeVisible({ timeout: 5_000 });
    await expect(warning).toContainText('Worktree missing');
  });
});

// ─── Working spinner + waiting beacon during a gate-held run ─────────────────

test.describe('§sessions-rows Working + waiting status dot during a gate-held run', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    // Widen the mock replay clamp for this describe: the transient 'working' dot is
    // broadcast at send (t≈0) but observed only via a debounced full-list refetch, and
    // the default ~120ms burst collapses the whole turn (incl. the permission that flips
    // the daemon to 'waiting') into a window the refetch races. An ~800ms ceiling delays
    // the burst so the leading refetch reliably lands while the daemon is still working.
    app = await launchTauriApp({ recordingKey: 'permissions-interactive', mockMaxDelayMs: 800 });
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

  // Previously: a backgrounded chat's `chat.notification` WS event never reached
  // the client — `broadcastEvent` scoped delivery to `client.subscriptions.has(chatId)`,
  // and per-chat subscriptions are torn down on deactivation, so the unread dot
  // never lit up. Fixed by the product-bug-fix campaign: `chat.notification` (and
  // `permission.requested`) are now connection-global (websocket.ts
  // `CONNECTION_GLOBAL_EVENT_TYPES`), reaching every client regardless of which
  // chat it's currently subscribed to.
  test('marks the row unread once a response lands while a different chat is active, and clears it on reselect', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowA = sidebar.row(chatIdA);
    const rowB = sidebar.row(chatIdB);
    const dotA = rowA.getByTestId('sessions-row-status-dot');

    // Chat B is active (created last, per createTauriChat's select-on-create) —
    // select A first so the message below originates from A's composer.
    await rowA.click();
    await expect(rowA).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    // Switch away immediately — A is now the BACKGROUND chat while its response
    // streams in, which is exactly the scenario chat.notification exists for.
    await rowB.click();
    await expect(rowB).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    // A's response lands in the background: chat.notification reaches the
    // client and session-list-router's onMarkUnread(chatIdA) flips the logo
    // glyph to the vivid unread tint (statusLogoClass's unread branch).
    await expect(dotA).toHaveClass(/text-primary/, { timeout: 45_000 });
    await expect(dotA).toHaveAttribute('aria-label', 'idle');

    // Reselecting A clears the unread flag.
    await rowA.click();
    await expect(rowA).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
    await expect(dotA).not.toHaveClass(/text-primary/, { timeout: 10_000 });
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
