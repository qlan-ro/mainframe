/**
 * §sessions-filters — Sessions sidebar project switcher + tag filter bar +
 * sort menu + empty-state specs for app-tauri browser mode.
 *
 * Ported from plan spec #3 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). All tests run in E2E_MODE=mock (no AI turn needed — these are
 * UI-only sidebar interactions over REST-seeded projects/chats).
 *
 * The project bar is a vertical LIST in the sidebar header since the v2 shell
 * integration (`@v2/features/sessions/ProjectSection.tsx` + `ProjectRow.tsx`),
 * not the `ProjectFilterPillBar` pill cloud: every project has a row, the tail
 * collapses behind "Show N more" past a COUNT (VISIBLE_LIMIT = 3), and nothing
 * measures available width any more. The old width-driven `expandProjectPills`
 * helper is therefore gone — with two projects both rows are always rendered.
 *
 * Testid reference (verified against packages/ui/src/v2/features/sessions/):
 *   sidebar-project-all               — "All projects" row (was `sessions-filter-pill-all`)
 *   sidebar-project-<projectId>       — one project row (was `sessions-filter-pill-<id>`);
 *                                       aria-pressed carries the selection
 *   sidebar-project-badge-<projectId> — attention count on a row (was
 *                                       `sessions-filter-pill-attn-<id>`)
 *   sidebar-project-badge-all         — attention count on the "All projects" row
 *   sidebar-project-rename-menu-<id>  — context menu "Rename Project" (always disabled)
 *   sidebar-project-remove-menu-<id>  — context menu "Remove Project"
 *   sidebar-project-remove-<id>       — the same action, hover-revealed on the row
 *   sidebar-project-hint-dismiss      — "Don't show anymore" inside the right-click hint
 *                                       tooltip (DismissibleHint, was `sessions-pill-hint-dismiss`)
 *   sidebar-projects-add              — the header's "+" add-project action (was the dashed
 *                                       `sessions-add-project` pill)
 *   sidebar-project-more              — "Show N more"/"Show less" tail toggle (was
 *                                       `sessions-projects-more`); count-driven, not width-driven
 *   sessions-remove-project-dialog / -confirm / -cancel — in-app confirm dialog
 *                                       (ConfirmDialogHost → v2 ConfirmDialog, testid from
 *                                       use-remove-project.ts's requestConfirm)
 *   sessions-tag-filter-bar           — TagFilterBar root, in the sidebar FOOTER (absent when
 *                                       no tag is in use)
 *   sessions-tag-filter-<name>        — a tag chip in the filter bar
 *   sessions-tag-filter-synthetic-<kind> — has-pr/has-worktree chip
 *   sessions-row-action-tags          — row hover action that opens the TagPopover
 *   sessions-tag-popover              — TagPopover content root
 *   sessions-tag-popover-search       — TagPopover search/create input
 *   sessions-sort-button              — "Sort by" trigger, on the parked list header
 *   sessions-sort-popover             — sort menu content
 *   sessions-sort-<recent|name|status|project> — sort radio items
 *   sessions-section-jump             — the PARKED first-group header. The first group's
 *                                       label is drawn here (SidebarJumpSection), and
 *                                       `SessionListVirtuoso` deliberately renders a hairline
 *                                       instead of a duplicate header for group 0 — so
 *                                       `sessions-group-header-<label>` exists only for the
 *                                       SECOND group onward, and the sort-mode label has to
 *                                       be read off the parked header.
 *   sidebar-sessions-empty            — empty-list message (was `sessions-empty-state`)
 *   directory-picker / directory-picker-cancel — DirectoryPickerModal (add-project flow)
 *   TOAST.root (helpers/tauri/testids.ts) — native sonner toast; WsToastCard is gone
 *
 * NOTE: the shared page object is `sessionsSidebar().projectRow(id)` /
 * `.allProjectsRow()` now (the old `projectFilterPill` pointed at the deleted
 * `sessions-filter-pill-<id>`); this file keeps its own local `projectRow()` because
 * every test here needs the row directly.
 *
 * THE PROJECT SWITCHER IS VIEW-ONLY (D12, packages/ui/CLAUDE.md): `ProjectSection`'s
 * `onSelect` is wired straight to `useSessionFilters.setFilterProjectId` and to
 * nothing else — picking a project narrows the list and never activates a session,
 * and clearing the filter never touches the active thread. Only
 * `useSessionListRouter` moves the active thread (boot auto-select, archived-active
 * fallback, first-send handoff). Assertions here therefore prove what the switcher
 * does NOT do; activating a session is always an explicit row click.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { closeMenus } from '../helpers/tauri/menus.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { TOAST } from '../helpers/tauri/testids.js';
import { sendMessage, waitConnected } from '../helpers/tauri/wait.js';

const TAG_NAME = 'e2e-filter';

/** One row of the project switcher list. */
function projectRow(page: Page, projectId: string): Locator {
  return page.getByTestId(`sidebar-project-${projectId}`);
}

/**
 * Select a session row, first clearing whatever hover card the PREVIOUS row opened.
 *
 * `SessionRow` wraps itself in a HoverCard (SessionMetaCard, 500ms openDelay) that
 * pops out to the right and hangs DOWN over its own siblings, so moving from one row
 * to the next lands the click on the card instead of the row: measured live as row B
 * staying inactive with A's card covering it. Parking the pointer at 0,0 dismisses
 * the card; the same workaround is in sessions-tags.spec.ts.
 */
async function selectRow(page: Page, row: Locator): Promise<void> {
  // Retried as a whole: the card has a 500ms openDelay, so it can appear BETWEEN the
  // dismissal and the click and eat it — leaving the click "successful" (Playwright's
  // hit test saw the row) with the row never activating. The budget is generous
  // because the list is recency-sorted, so a row can also be MOVING while the other
  // chat streams. Bounded, and every wait inside is on state.
  await expect(async () => {
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-slot="hover-card-content"]')).toHaveCount(0, { timeout: 2_000 });
    await row.click({ timeout: 5_000 });
    await expect(row).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });
}

/** The parked header of the first session group — it carries the active grouping's label. */
function parkedGroupLabel(page: Page): Locator {
  return page.getByTestId('sessions-section-jump');
}

// ─── §sessions-filters Project switcher + tag filter bar + sort menu ─────────

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

  test('"All projects" is selected by default and shows every session', async () => {
    const { page } = app;

    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(projectRow(page, projectB.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
  });

  test('clicking a project row filters the list and leaves the active session alone', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // `createTauriChat` selects each chat it creates, so B — created last — is the
    // active thread on entry.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await projectRow(page, projectA.projectId).click();

    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('aria-pressed', 'false');

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdA);
    // View-only (D12): A's session is NOT activated by narrowing to A, and the
    // active thread stays B — which the filter just hid, so nothing in the
    // visible list carries the active flag.
    await expect(page.locator('[data-testid="sessions-row"][data-active="true"]')).toHaveCount(0);
  });

  test('clicking the already-active project row is a no-op (single-select switcher, not a toggle)', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    await projectRow(page, projectA.projectId).click();
    await projectRow(page, projectA.projectId).click();

    // The project switcher is a single-select list — only the "All projects" row
    // clears the filter, a second click on the active row no longer deselects it
    // (that toggle-off behavior belonged to the old pill-cloud bar).
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('sessions-row')).toHaveCount(1, { timeout: 10_000 });

    // Activating a session is the user's job, not the switcher's — click A's row so
    // the next step can prove that clearing the filter leaves it alone.
    await sidebar.row(chatIdA).click();
    await expect(sidebar.row(chatIdA)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await page.getByTestId('sidebar-project-all').click();
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });

    // The previously-activated session (A) is still the active one — clearing
    // the filter is view-only and does not touch the active thread (D12).
    await expect(sidebar.row(chatIdA)).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('switching to a different project re-narrows the list; the active session survives both hops', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // A's session is active on entry (the previous test selected it).
    await expect(sidebar.row(chatIdA)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await projectRow(page, projectB.projectId).click();
    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdB);

    await page.getByTestId('sidebar-project-all').click();
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    // Neither hop moved the active thread: A is still selected even though the
    // B filter hid it in between.
    await expect(sidebar.row(chatIdA)).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('right-click hint dismiss persists across reload', async () => {
    const { page } = app;
    // The hint now wraps the project ROW itself (ProjectRow.tsx puts
    // DismissibleHint around the ContextMenuTrigger), so there is no separate
    // `-wrap` element to hover.
    await projectRow(page, projectA.projectId).hover();
    // Radix `TooltipContent` renders `children` TWICE — the real interactive
    // popper content, plus an SR-only `VisuallyHidden` accessibility echo
    // (`@radix-ui/react-tooltip` TooltipContentImpl) carrying the identical
    // subtree, so an interactive/testid-bearing child like our dismiss button
    // always resolves to 2 DOM matches. The real (clickable) copy renders
    // first in `TooltipContentImpl`'s children array — `.first()` targets it.
    const dismissBtn = page.getByTestId('sidebar-project-hint-dismiss').first();
    await expect(dismissBtn).toBeVisible({ timeout: 10_000 });
    await dismissBtn.click();

    await page.reload();
    await waitConnected(page);

    await projectRow(page, projectA.projectId).waitFor({ timeout: 10_000 });
    await projectRow(page, projectA.projectId).hover();
    // Dismissed hints render the bare child — the tooltip infrastructure (and
    // its dismiss button, both DOM copies) is never mounted, so this is a
    // structural absence, not a timing race.
    await expect(page.getByTestId('sidebar-project-hint-dismiss')).toHaveCount(0);
  });

  test('right-click menu shows Rename disabled and Remove enabled', async () => {
    const { page } = app;

    await projectRow(page, projectA.projectId).click({ button: 'right' });

    const renameItem = page.getByTestId(`sidebar-project-rename-menu-${projectA.projectId}`);
    await expect(renameItem).toBeVisible({ timeout: 5_000 });
    await expect(renameItem).toContainText('Rename Project');
    await expect(renameItem).toHaveAttribute('data-disabled');

    const removeItem = page.getByTestId(`sidebar-project-remove-menu-${projectA.projectId}`);
    await expect(removeItem).toBeVisible();
    await expect(removeItem).toContainText('Remove Project');
    await expect(removeItem).not.toHaveAttribute('data-disabled');

    await page.keyboard.press('Escape');
    await expect(renameItem).toHaveCount(0, { timeout: 5_000 });
  });

  test('the add-project action opens the directory picker', async () => {
    const { page } = app;

    // The dashed "Add project" pill is gone with the pill bar; the affordance is
    // the Projects section's own "+" (SidebarGroupAction in ProjectSection.tsx).
    await page.getByTestId('sidebar-projects-add').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('directory-picker-cancel').click();
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

  test('toggling a tag chip filters the session list', async () => {
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

  test('sort menu switches sort mode and the parked group label changes', async () => {
    const { page } = app;

    // Read off the PARKED header: the first group's label lives there, and the
    // windowed list draws `sessions-group-header-<label>` only from the second
    // group onward (SessionListVirtuoso.tsx `groupIndex === 0` hairline). With
    // no pinned session every sort mode here produces exactly one group.
    //
    // `closeMenus` between hops is load-bearing: Radix keeps the selected menu's
    // content mounted through its exit animation, and a trigger click inside that
    // window is SWALLOWED — the menu never reopens and the next radio item never
    // exists. That is exactly how `sessions-sort-status` used to time out with the
    // menu visibly closed in the failure screenshot.
    const selectSort = async (id: 'recent' | 'name' | 'status'): Promise<void> => {
      await closeMenus(page);
      await page.getByTestId('sessions-sort-button').click();
      await expect(page.getByTestId('sessions-sort-popover')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId(`sessions-sort-${id}`).click();
    };

    await selectSort('name');
    await expect(parkedGroupLabel(page)).toHaveText('A–Z', { timeout: 10_000 });

    await selectSort('status');
    await expect(parkedGroupLabel(page)).toHaveText('By status', { timeout: 10_000 });

    await selectSort('recent');
    await expect(parkedGroupLabel(page)).toHaveText('Today', { timeout: 10_000 });
  });

  test('project switcher overflow "Show N more"/"Show less" toggle', async () => {
    // Half of what this covered no longer exists: TagFilterBar (v2) has NO
    // overflow toggle at all — past three rows of chips the grid scrolls
    // (GRID_MAX_HEIGHT), so there is no `sessions-tag-filter-more` successor.
    //
    // The project half is still real and no longer width-dependent:
    // `ProjectSection.tsx` collapses the tail behind `sidebar-project-more`
    // once projects.length > VISIBLE_LIMIT (3), which needs a 4-project
    // fixture — this describe seeds 2.
    test.skip(
      true,
      'TODO(app-tauri): `sidebar-project-more` needs a 4+-project fixture (VISIBLE_LIMIT = 3); the tag-bar overflow toggle was deleted in favour of a scrolling chip grid',
    );
  });

  // Attention badges are driven by useUnreadStore.markUnread, which is only
  // called by the session-list-router on a `chat.notification` /
  // `permission.requested{notify:true}` WS event. Previously that event never
  // reached the client for a BACKGROUND chat (see the sessions-rows.spec.ts
  // unread-dot test for the root cause); now that chat.notification is
  // connection-global, project A's badge lights up while B stays active.
  test('attention badges appear on non-filtered project rows', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    const rowA = sidebar.row(chatIdA);
    const rowB = sidebar.row(chatIdB);
    await selectRow(page, rowA);

    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    // Switch to B immediately — A is now the BACKGROUND chat while its
    // response streams in.
    await selectRow(page, rowB);

    const badgeA = page.getByTestId(`sidebar-project-badge-${projectA.projectId}`);
    await expect(badgeA).toBeVisible({ timeout: 45_000 });
    await expect(badgeA).toHaveText('1');

    // Reselecting A's chat clears the unread flag, and with it the row badge.
    await selectRow(page, rowA);
    await expect(badgeA).toHaveCount(0, { timeout: 10_000 });
  });

  test('synthetic has-pr/has-worktree chips render once a session carries one', async () => {
    // has-pr / has-worktree synthetic chips only render once hasSynthetic()
    // is true (a session with a real worktree path or a detected PR). Seeding
    // a worktree/PR is out of scope for a filter-bar UI spec — covered by the
    // dedicated git-branch/review-panel specs.
    test.skip(true, 'TODO(app-tauri): synthetic has-pr/has-worktree chips need a worktree/PR fixture');
  });

  test('right-click Remove Project removes it after confirm, with a toast', async () => {
    const { page } = app;

    await projectRow(page, projectB.projectId).click({ button: 'right' });
    await page.getByTestId(`sidebar-project-remove-menu-${projectB.projectId}`).click();

    await expect(page.getByTestId('sessions-remove-project-dialog')).toBeVisible();
    await page.getByTestId('sessions-remove-project-dialog-confirm').click();

    await expect(projectRow(page, projectB.projectId)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(TOAST.root).filter({ hasText: 'Project removed' })).toBeVisible({
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

  test('shows "No sessions yet." when there are no filters and no sessions', async () => {
    const { page } = app;
    const empty = page.getByTestId('sidebar-sessions-empty');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toHaveText('No sessions yet.');
  });

  test('shows "No sessions match these filters." once a filter is active', async () => {
    const { page } = app;

    await projectRow(page, project.projectId).click();

    const empty = page.getByTestId('sidebar-sessions-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toHaveText('No sessions match these filters.');
  });
});
