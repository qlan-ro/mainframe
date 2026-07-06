/**
 * §sessions-filters — Sessions sidebar project pill bar + tag filter bar +
 * sort menu + empty-state specs for app-tauri browser mode.
 *
 * Ported from plan spec #3 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). All tests run in E2E_MODE=mock (no AI turn needed — these are
 * UI-only sidebar interactions over REST-seeded projects/chats).
 *
 * Testid reference (verified against packages/ui/src/features/sessions/sidebar/
 * and packages/ui/src/features/sessions/filter/TagFilterBar.tsx):
 *   sessions-filter-pill-all          — "All" pill (FilterPill)
 *   sessions-filter-pill-<projectId>  — per-project pill (ProjectPillContextMenu)
 *   sessions-project-rename-<id>      — context menu "Rename Project" (always disabled)
 *   sessions-project-remove-<id>      — context menu "Remove Project"
 *   sessions-pill-hint-dismiss        — "Don't show anymore" button inside the
 *                                        hover tooltip wrapping a project pill
 *   sessions-add-project              — dashed "Add project" affordance
 *   sessions-projects-more            — project bar "+N more"/"Less" toggle
 *   sessions-tag-filter-bar           — TagFilterBar root (absent when no tags in use)
 *   sessions-tag-filter-<name>        — a tag pill in the filter bar
 *   sessions-tag-filter-synthetic-<kind> — has-pr/has-worktree chip (expanded only)
 *   sessions-tag-filter-more          — tag bar "+N more"/"Less" toggle
 *   sessions-row-action-tags          — row hover action that opens the TagPopover
 *   sessions-tag-popover              — TagPopover content root
 *   sessions-tag-popover-search       — TagPopover search/create input
 *   sessions-sort-button              — "Sort by" trigger (chevron up/down)
 *   sessions-sort-popover             — sort popover content
 *   sessions-sort-<recent|name|status> — sort option rows
 *   sessions-group-header-<label>     — group header ("Today"/"Yesterday"/"A–Z"/"By status"/"Pinned")
 *   sessions-empty-state              — empty-list message
 *   directory-picker / directory-picker-close — DirectoryPickerModal (add-project flow)
 *   toast-root                        — WsToastCard root (remove-project confirmation)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { sendMessage, waitConnected } from '../helpers/tauri/wait.js';

const TAG_NAME = 'e2e-filter';

/**
 * Expand the project-pill bar's "+N more" overflow toggle if it's collapsed.
 * The sidebar is a fixed 280px wide (SidebarShell.tsx SIDEBAR_EXPANDED_WIDTH)
 * and ProjectFilterPillBar's useRowOverflow measures real available width —
 * two `mf-e2e-<hex>`-named project pills genuinely don't fit next to "All" +
 * "Add project" at that width (verified live: visibleCount resolves to 0), so
 * every per-project-pill interaction in this file needs the overflow open
 * first. `expanded` is local React state, so it resets on every full page
 * reload too. Idempotent — a no-op once already expanded.
 */
async function expandProjectPills(page: Page): Promise<void> {
  const more = page.getByTestId('sessions-projects-more');
  if (!(await more.isVisible().catch(() => false))) return;
  if ((await more.getAttribute('aria-expanded')) === 'true') return;
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  // Expanding wraps the row onto a second line (flex-wrap) — a project pill
  // can reflow to land exactly under the still-stationary cursor (the click
  // above never moved the mouse), which the browser treats as a fresh hover
  // and opens that pill's tooltip. Park the cursor away from the row so a
  // later `pillWrap.hover()` isn't racing an unrelated tooltip's close
  // animation (Radix keeps `TooltipContent` mounted, and thus still
  // `visible`-matchable, through the fade-out).
  await page.mouse.move(0, 0);
}

// ─── §sessions-filters Project pill bar + tag filter bar + sort menu ─────────

test.describe('§sessions-filters Project + tag filter bar', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;
  let chatIdA: string;
  let chatIdB: string;

  test.beforeAll(async () => {
    // recordingKey backs the (background-chat notification) attention-badges
    // test below; every other test in this describe is REST/UI-only and never
    // calls sendMessage, so wiring it here doesn't affect them.
    app = await launchTauriApp({ recordingKey: 'messaging' });
    projectA = await createTauriProject(app.page);
    chatIdA = await createTauriChat(app.page, projectA.projectId, 'default');
    // createTauriProject reloads the page — re-seeds the project list without
    // dropping the chat we just created (REST-seeded, survives reload).
    projectB = await createTauriProject(app.page);
    chatIdB = await createTauriChat(app.page, projectB.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(projectA);
    cleanupTauriProject(projectB);
    await closeTauriApp(app);
  });

  test('"All" pill is selected by default and shows every session', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    await expect(page.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.projectFilterPill(projectA.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(sidebar.projectFilterPill(projectB.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
  });

  test("clicking a project pill filters the list AND activates that project's session", async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    await sidebar.projectFilterPill(projectA.projectId).click();

    await expect(sidebar.projectFilterPill(projectA.projectId)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'false');

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdA);
    await expect(rows.first()).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
  });

  test('clicking the active project pill again clears the filter but keeps the active session', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    await sidebar.projectFilterPill(projectA.projectId).click();

    await expect(sidebar.projectFilterPill(projectA.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });

    // The previously-activated session (A) is still the active one — clearing
    // the filter is view-only and does not touch the active thread (D12).
    const rowA = sidebar.row(chatIdA);
    await expect(rowA).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('selecting a different project pill switches the active session; "All" resets the filter', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    await sidebar.projectFilterPill(projectB.projectId).click();
    const rowB = sidebar.row(chatIdB);
    await expect(rowB).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
    await expect(page.getByTestId('sessions-row')).toHaveCount(1, { timeout: 10_000 });

    await page.getByTestId('sessions-filter-pill-all').click();
    await expect(page.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
    // "All" click is unconditional (not toggle-based) — it never touches the
    // active thread, so B (activated above) remains selected.
    await expect(rowB).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('right-click hint dismiss persists across reload', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);
    const pillWrap = page.getByTestId(`sessions-filter-pill-${projectA.projectId}-wrap`);

    await pillWrap.hover();
    // Radix `TooltipContent` renders `children` TWICE — the real interactive
    // popper content, plus an SR-only `VisuallyHidden` accessibility echo
    // (`@radix-ui/react-tooltip` TooltipContentImpl) carrying the identical
    // subtree, so an interactive/testid-bearing child like our dismiss button
    // always resolves to 2 DOM matches. The real (clickable) copy renders
    // first in `TooltipContentImpl`'s children array — `.first()` targets it.
    const dismissBtn = page.getByTestId('sessions-pill-hint-dismiss').first();
    await expect(dismissBtn).toBeVisible({ timeout: 10_000 });
    await dismissBtn.click();

    await page.reload();
    await waitConnected(page);
    await expandProjectPills(page);

    await sidebar.projectFilterPill(projectA.projectId).waitFor({ timeout: 10_000 });
    await page.getByTestId(`sessions-filter-pill-${projectA.projectId}-wrap`).hover();
    // Dismissed hints render the bare child — the tooltip infrastructure (and
    // its dismiss button, both DOM copies) is never mounted, so this is a
    // structural absence, not a timing race.
    await expect(page.getByTestId('sessions-pill-hint-dismiss')).toHaveCount(0);
  });

  test('right-click menu shows Rename disabled and Remove enabled', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    await sidebar.projectFilterPill(projectA.projectId).click({ button: 'right' });

    const renameItem = page.getByTestId(`sessions-project-rename-${projectA.projectId}`);
    await expect(renameItem).toBeVisible({ timeout: 5_000 });
    await expect(renameItem).toContainText('Rename Project');
    await expect(renameItem).toHaveAttribute('data-disabled');

    const removeItem = page.getByTestId(`sessions-project-remove-${projectA.projectId}`);
    await expect(removeItem).toBeVisible();
    await expect(removeItem).toContainText('Remove Project');
    await expect(removeItem).not.toHaveAttribute('data-disabled');

    await page.keyboard.press('Escape');
    await expect(renameItem).toHaveCount(0, { timeout: 5_000 });
  });

  test('add-project dashed pill opens the directory picker', async () => {
    const { page } = app;

    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('directory-picker-close').click();
    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });

  test('tag filter bar is absent until a tag is in use', async () => {
    const { page } = app;
    await expect(page.getByTestId('sessions-tag-filter-bar')).toHaveCount(0);
  });

  test('applying a tag to a session surfaces it in the tag filter bar', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowA = sidebar.row(chatIdA);

    await rowA.hover();
    await rowA.getByTestId('sessions-row-action-tags').evaluate((el) => (el as HTMLElement).click());

    const popover = page.getByTestId('sessions-tag-popover');
    await expect(popover).toBeVisible({ timeout: 5_000 });

    const search = page.getByTestId('sessions-tag-popover-search');
    await search.fill(TAG_NAME);
    await search.press('Enter');

    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0, { timeout: 5_000 });

    await expect(page.getByTestId('sessions-tag-filter-bar')).toBeVisible({ timeout: 10_000 });
    const tagPill = page.getByTestId(`sessions-tag-filter-${TAG_NAME}`);
    await expect(tagPill).toBeVisible();
    await expect(tagPill).toHaveAttribute('aria-pressed', 'false');
  });

  test('toggling a tag pill filters the session list', async () => {
    const { page } = app;
    const tagPill = page.getByTestId(`sessions-tag-filter-${TAG_NAME}`);

    await tagPill.click();
    await expect(tagPill).toHaveAttribute('aria-pressed', 'true');
    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdA);

    await tagPill.click();
    await expect(tagPill).toHaveAttribute('aria-pressed', 'false');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
  });

  test('sort menu switches sort mode and the group headers change', async () => {
    const { page } = app;

    await page.getByTestId('sessions-sort-button').click();
    await expect(page.getByTestId('sessions-sort-popover')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('sessions-sort-name').click();
    await expect(page.getByTestId('sessions-group-header-A–Z')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('sessions-sort-button').click();
    await page.getByTestId('sessions-sort-status').click();
    await expect(page.getByTestId('sessions-group-header-By status')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('sessions-sort-button').click();
    await page.getByTestId('sessions-sort-recent').click();
    await expect(page.getByTestId('sessions-group-header-Today')).toBeVisible({ timeout: 10_000 });
  });

  test('project-pill and tag-filter-bar overflow "+N more"/"Less" toggle', async () => {
    // The project-pill and tag-filter-bar overflow rows collapse based on
    // measured available width via useRowOverflow, but the sidebar content
    // frame is pinned to a hard `minWidth: SIDEBAR_EXPANDED_WIDTH` (280px,
    // packages/ui/src/layout/SidebarShell.tsx) — narrowing the browser
    // viewport does NOT narrow the pill row, so collapse cannot be forced
    // deterministically with only 2 projects / 1 tag. Forcing it would
    // require seeding 6+ projects and several tags, out of scope for this
    // 2-project spec.
    test.skip(
      true,
      'TODO(app-tauri): overflow "+N more" needs 6+ projects/tags (sidebar minWidth floor defeats viewport narrowing)',
    );
  });

  // Attention badges are driven by useUnreadStore.markUnread, which is only
  // called by the session-list-router on a `chat.notification` /
  // `permission.requested{notify:true}` WS event. Previously that event never
  // reached the client for a BACKGROUND chat (see the sessions-rows.spec.ts
  // unread-dot test for the root cause); now that chat.notification is
  // connection-global, project A's badge lights up while B stays active.
  test('attention badges appear on non-filtered pills', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    const rowA = sidebar.row(chatIdA);
    const rowB = sidebar.row(chatIdB);
    await rowA.click();
    await expect(rowA).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    // Switch to B immediately — A is now the BACKGROUND chat while its
    // response streams in.
    await rowB.click();
    await expect(rowB).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    const badgeA = page.getByTestId(`sessions-filter-pill-attn-${projectA.projectId}`);
    await expect(badgeA).toBeVisible({ timeout: 45_000 });
    await expect(badgeA).toHaveText('1');

    // Reselecting A's chat clears the unread flag, and with it the pill badge.
    await rowA.click();
    await expect(badgeA).toHaveCount(0, { timeout: 10_000 });
  });

  test('synthetic has-pr/has-worktree chips render only in the expanded state', async () => {
    // has-pr / has-worktree synthetic chips only render once hasSynthetic()
    // is true (a session with a real worktree path or a detected PR) AND the
    // tag bar is expanded. Seeding a worktree/PR is out of scope for a
    // filter-bar UI spec — covered by the dedicated git-branch/review-panel specs.
    test.skip(true, 'TODO(app-tauri): synthetic has-pr/has-worktree chips need a worktree/PR fixture');
  });

  test('right-click Remove Project removes it after confirm, with a toast', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    page.once('dialog', (dialog) => {
      void dialog.accept();
    });

    await sidebar.projectFilterPill(projectB.projectId).click({ button: 'right' });
    await page.getByTestId(`sessions-project-remove-${projectB.projectId}`).click();

    await expect(page.getByTestId(`sessions-filter-pill-${projectB.projectId}`)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('toast-root').filter({ hasText: 'Project removed' })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── §sessions-filters Empty state ────────────────────────────────────────────

test.describe('§sessions-filters Empty state', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    // No chat created — this project has zero sessions.
    project = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('shows "No sessions yet" when there are no filters and no sessions', async () => {
    const { page } = app;
    const empty = page.getByTestId('sessions-empty-state');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toHaveText('No sessions yet');
  });

  test('shows "No sessions match these filters." once a filter is active', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    await sidebar.projectFilterPill(project.projectId).click();

    const empty = page.getByTestId('sessions-empty-state');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toHaveText('No sessions match these filters.');
  });
});
