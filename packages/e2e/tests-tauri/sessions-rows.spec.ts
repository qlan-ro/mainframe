/**
 * §sessions-rows — The session row as a human uses it: click-to-select, hover
 * actions, the right-click context menu, pin/unpin, the row's one trailing value
 * (spinner, "needs you" or the time), and the hover-card detail.
 *
 * Ported from plan spec #2 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). Does NOT duplicate: sessions.spec.ts (rename/archive/restore/
 * import), sessions-filters.spec.ts (pills/tag-bar/sort), sessions-tags.spec.ts
 * (tag popover internals — this file only asserts the tag on the hover card).
 *
 * Source (verified against packages/ui/src/v2/features/sessions/):
 *   SessionRow.tsx          — row root, RowHoverActions, hover card, context menu
 *   SessionRowBody.tsx      — the one line: project letter, title, trailing value
 *   SessionRowStatus.tsx    — the trailing value
 *   SessionMetaCard.tsx     — hover-card detail (project/worktree/branch/PR/tags/warning)
 *   SessionContextMenu.tsx  — right-click menu (Pin/Unpin, Rename, Tags, Archive, Copy Session ID)
 *   SessionGroupHeader.tsx  — header for the SECOND group onward (see the note below)
 *   view-model/session-status.ts — sessionStatus (needs-you > running > idle)
 *
 * Testid reference (all verified against source above):
 *   sessions-row                     — row root (data-chat-id, data-active)
 *   sessions-row-status              — the trailing value; `data-status` is
 *                                       'idle' | 'running' | 'needs-you'
 *   sessions-row-title               — the title; `data-unread="true"` while a response is unseen
 *   sessions-row-relative-time       — time label, present only while idle; it STAYS PUT on hover
 *                                       (the actions insert in front of it and the truncating
 *                                       title gives way instead)
 *   sessions-row-action-pin/-tags/-archive — hover-action buttons, MOUNTED on row hover rather
 *                                       than CSS-hidden (SessionRowHoverActions.tsx header);
 *                                       Rename is context-menu-only
 *   sessions-ctx-pin/-rename/-tags/-archive/-copy-id — context-menu items
 *   sessions-section-jump            — the PARKED first-group header. `SessionListVirtuoso`
 *                                       renders a hairline instead of a duplicate header for
 *                                       group 0, so 'Pinned' (always the FIRST group when a
 *                                       pinned session exists) never appears as
 *                                       `sessions-group-header-Pinned` — it is the parked
 *                                       label's text.
 *   sessions-group-header-<label>    — headers from the second group onward ('Today' below 'Pinned')
 *   sessions-meta-card-project       — project row inside the hover card
 *   sessions-meta-card-warning       — branch-safety warning inside the hover card
 *
 * NOTE: rows carry no pin glyph. Pinned-ness is asserted via the group label.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { rmSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { sendMessage, waitForIdle, waitConnected } from '../helpers/tauri/wait.js';
import { daemonFetch } from '../fixtures/daemon.js';

/**
 * The mock-cli replay caps every inter-event delay at 120ms (ReplaySession.MAX_DELAY_MS),
 * so the 'running' status (set synchronously by chat-manager.sendMessage, before any adapter
 * event) is only observable for a short window before the next recorded event (permission
 * request or result) flips it. Playwright's built-in expect() retry cadence is too coarse to
 * reliably sample that window, so this polls the DOM directly via requestAnimationFrame.
 */
async function waitForRunningSpinner(page: Page, chatId: string, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const row = document.querySelector(`[data-testid="sessions-row"][data-chat-id="${id}"]`);
      const status = row?.querySelector('[data-testid="sessions-row-status"]');
      return status?.getAttribute('data-status') === 'running';
    },
    chatId,
    { timeout, polling: 'raf' },
  );
}

/**
 * Select a session row, retrying the click until the row reports itself active.
 *
 * The list is sorted by recency, so a row can slide out from under the pointer
 * between Playwright's actionability check and the click: sending a message bumps
 * its own chat to the top of the group and pushes every row below it down one
 * slot. The click then lands on the neighbour, and the row under test never
 * activates — the row is still there and still hittable, so nothing reports an
 * interception; the selection simply went elsewhere. Re-clicking a row that is
 * already active is a no-op, so the retry only ever costs the one wasted click.
 */
async function selectRow(row: Locator): Promise<void> {
  await expect(async () => {
    await row.click();
    await expect(row).toHaveAttribute('data-active', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
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

  test('a fresh, read chat shows its project letter and the time', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);

    await expect(rowX.getByTestId('sessions-row-status')).toHaveAttribute('data-status', 'idle');
    await expect(rowX.getByTestId('sessions-row-relative-time')).toBeVisible();
    await expect(rowX.getByTestId('sessions-row-title')).not.toHaveAttribute('data-unread');
    const initial = path.basename(project.projectPath).charAt(0).toUpperCase();
    await expect(rowX.getByTestId('sessions-row-project-tile')).toHaveText(initial);
  });

  test('group actions appear on hover and on keyboard focus', async () => {
    const { page } = app;
    const header = page.getByTestId('sessions-section-jump');
    const filter = page.getByTestId('sessions-filter-button');
    const sort = page.getByTestId('sessions-sort-button');

    await page.mouse.move(0, 0);
    await expect(filter).toHaveCSS('opacity', '0');
    await expect(sort).toHaveCSS('opacity', '0');

    await header.hover();
    await expect(filter).toHaveCSS('opacity', '1');
    await expect(sort).toHaveCSS('opacity', '1');

    await page.mouse.move(0, 0);
    await expect(sort).toHaveCSS('opacity', '0');

    await header.focus();
    await page.keyboard.press('Tab');
    await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS('opacity', '1');
    await expect(sort).toHaveCSS('opacity', '1');
    await filter.blur();
  });

  test('hovering a row reveals the pin/tag/archive actions in front of the relative time', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    const relTime = rowX.getByTestId('sessions-row-relative-time');
    const tagsBtn = rowX.getByTestId('sessions-row-action-tags');
    // The inline Rename hover button was dropped by design (the context menu owns
    // Rename — SessionRowHoverActions.tsx) and a Pin/Unpin button added as the
    // primary pin entry point.
    const pinBtn = rowX.getByTestId('sessions-row-action-pin');
    const archiveBtn = rowX.getByTestId('sessions-row-action-archive');

    // Establish a clean non-hovered baseline first — the previous test's
    // `rowX.click()` leaves the real mouse cursor positioned over this row,
    // which would otherwise arrive here already hovered.
    await page.mouse.move(0, 0);
    await expect(relTime).toBeVisible();
    // The cluster is MOUNTED from the row's hover state, not CSS-hidden: a display
    // flip left an open Hint tooltip anchored to a zero-rect element the instant
    // the pointer left the row (SessionRowHoverActions.tsx header). So absence,
    // not invisibility.
    await expect(tagsBtn).toHaveCount(0);

    await rowX.hover();
    await expect(tagsBtn).toBeVisible();
    await expect(pinBtn).toBeVisible();
    await expect(archiveBtn).toBeVisible();
    // The time no longer yields to the actions — they insert in front of it and
    // the truncating title is what gives way (SessionRow.tsx RowBody).
    await expect(relTime).toBeVisible();

    // Reset hover so it doesn't bleed into later tests.
    await page.mouse.move(0, 0);
    await expect(tagsBtn).toHaveCount(0);
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

    // Past the hover card's 500ms open delay, with the pointer still resting on the
    // row from the right-click: the card must NOT open over the menu. It used to,
    // and since Radix only lets its TOP dismissable layer answer Escape, the menu
    // then stayed up (a CI-only failure — locally the assertions above finish inside
    // the 500ms). SessionRow refuses the open while its context menu is up.
    await page.waitForTimeout(900);
    await expect(page.locator('[data-slot="hover-card-content"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(pinItem).toHaveCount(0, { timeout: 5_000 });
  });

  test('pinning via the context menu moves the row into a Pinned group; unpinning reverts it', async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);
    // 'Pinned' is always the FIRST group, and the windowed list draws a hairline
    // instead of a duplicate header for group 0 (SessionListVirtuoso.tsx) — so the
    // Pinned label lives on the PARKED header, and 'Today' (now group 1) is the
    // one that gets a `sessions-group-header-*`. The header still carries no pin
    // glyph by design (plain-text section headers, macOS pattern).
    const parkedLabel = page.getByTestId('sessions-section-jump');
    const todayHeader = page.getByTestId('sessions-group-header-Today');

    await expect(parkedLabel).toHaveText('Today');

    await rowX.click({ button: 'right' });
    await page.getByTestId('sessions-ctx-pin').click();

    await expect(parkedLabel).toHaveText('Pinned', { timeout: 10_000 });
    await expect(todayHeader).toBeVisible({ timeout: 10_000 });
    await expect(rowX).toBeVisible();

    await rowX.click({ button: 'right' });
    const unpinItem = page.getByTestId('sessions-ctx-pin');
    await expect(unpinItem).toContainText('Unpin');
    await unpinItem.click();

    await expect(parkedLabel).toHaveText('Today', { timeout: 10_000 });
    await expect(todayHeader).toHaveCount(0, { timeout: 10_000 });
    await expect(rowX).toBeVisible();
  });

  test("hover card names the row's project", async () => {
    const { page } = app;
    const rowX = sessionsSidebar(page).row(chatIdX);

    // The row only carries the project's letter; the hover card spells it out.
    await rowX.hover();
    const cardProject = page.getByTestId('sessions-meta-card-project');
    // Exactly one card, named before the visibility check: a click-focused row used
    // to open a SECOND card that no pointerleave ever closed (Radix opens on focus
    // too), and the strict-mode violation that produced read as a locator error
    // rather than the duplicate-card bug it was.
    await expect(cardProject).toHaveCount(1, { timeout: 5_000 });
    await expect(cardProject).toBeVisible({ timeout: 5_000 });
    await expect(cardProject).toContainText(path.basename(project.projectPath));
  });

  test('applying a tag names it on the hover card', async () => {
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

    await page.mouse.move(0, 0);
    await rowX.hover();
    await expect(page.getByTestId('sessions-meta-card-tags')).toContainText(tagName, { timeout: 5_000 });
    await page.mouse.move(0, 0);
  });
});

// ─── Worktree on the hover card + missing state ───────────────────────────────────────

test.describe('§sessions-rows Worktree on the hover card + missing state', () => {
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

  test('the hover card names the worktree, and warns once it goes missing on disk', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);

    const enableRes = await daemonFetch(`/api/chats/${chatId}/enable-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseBranch: 'main', branchName: 'e2e-rows-worktree' }),
    });
    expect(enableRes.ok).toBe(true);

    await row.hover();
    await expect(page.getByTestId('sessions-meta-card-worktree')).toContainText('Worktree', { timeout: 15_000 });
    await expect(page.getByTestId('sessions-meta-card-warning')).toHaveCount(0);
    await page.mouse.move(0, 0);

    const chatRes = await daemonFetch(`/api/chats/${chatId}`);
    const chatBody = (await chatRes.json()) as { data?: { worktreePath?: string } };
    const worktreePath = chatBody.data?.worktreePath;
    if (!worktreePath) throw new Error('enable-worktree did not set worktreePath on the chat');
    rmSync(worktreePath, { recursive: true, force: true });

    // No FS watch on the daemon side — a reload forces the isWorktreePresent
    // re-check that flips worktreeMissing (see enrichChat in chat-manager.ts).
    await page.reload();
    await waitConnected(page);

    // The session still works, so the row keeps showing the time (L2).
    await expect(row.getByTestId('sessions-row-status')).toHaveAttribute('data-status', 'idle', { timeout: 15_000 });

    await row.hover();
    const warning = page.getByTestId('sessions-meta-card-warning');
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(warning).toContainText('Worktree missing');
  });
});

// ─── Running spinner + "needs you" during a gate-held run ─────────────────

test.describe('§sessions-rows Running + needs-you during a gate-held run', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    // Widen the mock replay clamp for this describe: the transient running spinner is
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

  test('shows a spinner while the CLI processes, then "needs you" once the permission gate lands', async () => {
    const { page } = app;
    const row = sessionsSidebar(page).row(chatId);
    const status = row.getByTestId('sessions-row-status');

    await expect(status).toHaveAttribute('data-status', 'idle');

    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    // chat-manager sets processState='working' synchronously on send (before any
    // adapter event), so this is reachable — but briefly, see waitForRunningSpinner.
    await waitForRunningSpinner(page, chatId);

    await page.locator('[data-testid="chat-permission-gate"]').waitFor({ timeout: 45_000 });
    // The same onPermission handler that surfaces the gate also emits the
    // chat.updated that flips displayStatus to 'waiting' — no race here.
    await expect(status).toHaveAttribute('data-status', 'needs-you', { timeout: 5_000 });
    await expect(status).toHaveText('needs you');

    // Clean up: deny so the mock session ends cleanly before teardown.
    await page.locator('[data-testid="chat-permission-option-reject-once"]').click();
    await waitForIdle(page, 60_000);
    await expect(status).toHaveAttribute('data-status', 'idle', { timeout: 10_000 });
  });
});

// ─── Unread title + copy session id ──────────────────────────────────────

test.describe('§sessions-rows Unread title + copy session id', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatIdA: string;
  let chatIdB: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    // Both chats created up front (beforeAll) to avoid the known mid-test
    // useSessionListRouter navigation race (see chat.spec.ts / the shared brief).
    //
    // B is created FIRST so that A, which the unread test sends from, is already the
    // most recent. The list sorts by recency: created the other way round, A's send
    // bumped it to the top and slid B down one slot exactly as the test clicked B,
    // and the click landed on the row that had moved into B's place.
    chatIdB = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    chatIdA = await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Previously: a backgrounded chat's `chat.notification` WS event never reached
  // the client — `broadcastEvent` scoped delivery to `client.subscriptions.has(chatId)`,
  // and per-chat subscriptions are torn down on deactivation, so the unread mark
  // never showed. Fixed by the product-bug-fix campaign: `chat.notification` is
  // now connection-global (websocket.rs `CONNECTION_GLOBAL_EVENT_TYPES`),
  // reaching every client regardless of which chat it's currently subscribed to.
  test('marks the row unread once a response lands while a different chat is active, and clears it on reselect', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowA = sidebar.row(chatIdA);
    const rowB = sidebar.row(chatIdB);
    const titleA = rowA.getByTestId('sessions-row-title');

    // A is already active (created last, per createTauriChat's select-on-create), so
    // the message below originates from A's composer.
    await selectRow(rowA);

    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    // Switch away immediately — A is now the BACKGROUND chat while its response
    // streams in, which is exactly the scenario chat.notification exists for. The
    // switch has to beat the reply, so nothing may be awaited between the two.
    await selectRow(rowB);

    // A's response lands in the background: chat.notification reaches the
    // client and session-list-router's onMarkUnread(chatIdA) marks the
    // title unread.
    await expect(titleA).toHaveAttribute('data-unread', 'true', { timeout: 45_000 });

    // Reselecting A clears the unread flag.
    await selectRow(rowA);
    await expect(titleA).not.toHaveAttribute('data-unread', { timeout: 10_000 });
  });

  test('copy-session-id appears once the chat has a claudeSessionId, and copies it to the clipboard', async () => {
    const { page } = app;
    const rowA = sessionsSidebar(page).row(chatIdA);

    const chatRes = await daemonFetch(`/api/chats/${chatIdA}`);
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
