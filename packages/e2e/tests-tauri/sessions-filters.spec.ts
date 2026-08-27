/**
 * §sessions-filters — Sessions sidebar project SCOPE selector + tag filter bar +
 * sort menu + empty-state specs for app-tauri browser mode.
 *
 * Ported from plan spec #3 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). All tests run in E2E_MODE=mock (no AI turn needed — these are
 * UI-only sidebar interactions over REST-seeded projects/chats).
 *
 * The inline projects list (a vertical row-per-project list in the sidebar
 * header) was replaced (2026-08-27) by `ProjectScopeSelector.tsx` — one header
 * dropdown trigger that opens a checkbox-item menu. Scope, not switcher: any
 * number of projects can be checked and the sessions list shows their union; an
 * empty scope means "All projects". The old width/count-driven "Show N more"
 * tail collapse is gone with the row list it belonged to.
 *
 * Testid reference (verified against packages/ui/src/features/sessions/ProjectScopeSelector.tsx):
 *   sidebar-project-scope-trigger     — the header dropdown trigger. Its label is
 *                                       "All projects" (empty scope), the sole
 *                                       project's name (scope of one), or "N
 *                                       projects" (scope of two or more)
 *   sidebar-project-scope-badge       — the trigger's count badge: attention
 *                                       HIDDEN by the scope (sum over unchecked
 *                                       projects); absent when the scope is empty
 *   sidebar-project-scope-clear       — the trigger's hover ✕; clears the whole
 *                                       scope WITHOUT opening the menu
 *   sidebar-project-scope-menu        — the dropdown's content root. Opens on a
 *                                       trigger click; toggling a project inside
 *                                       it does NOT close it (multi-select) — only
 *                                       Escape (or an outside click) closes it
 *   sidebar-project-all               — "All projects" checkbox item inside the
 *                                       menu; clears the scope
 *   sidebar-project-<projectId>       — one project's checkbox item inside the
 *                                       menu; TOGGLES that project in/out of the
 *                                       scope (checking an already-checked item
 *                                       unchecks it — this is multi-select, not a
 *                                       single-select switcher)
 *   sidebar-project-badge-<projectId> — a project item's own attention count
 *   sidebar-project-unavailable-<id>  — "Unavailable" badge for a project whose
 *                                       directory is missing on disk
 *   sidebar-project-remove-<id>       — hover-revealed remove affordance inside a
 *                                       project's menu item (the right-click
 *                                       context menu that used to carry this is
 *                                       deleted)
 *   sidebar-projects-add              — the header's standalone "+" add-project
 *                                       button, beside the trigger (unchanged)
 *   sidebar-project-scope-add         — the menu's own "Add project" item
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
 * DELETED with the inline row list, no successor: the right-click hint dismiss
 * (`sidebar-project-hint-dismiss`), the row's right-click context menu
 * (`sidebar-project-rename-menu-<id>` / `sidebar-project-remove-menu-<id>` —
 * remove is now the menu item's own hover affordance, see above), the
 * "Show N more"/"Show less" tail toggle (`sidebar-project-more`), and the "All
 * projects" row's own attention badge (`sidebar-project-badge-all` — the
 * trigger's `sidebar-project-scope-badge` now shows only attention the scope
 * HIDES, which is by definition 0 while unscoped).
 *
 * NOTE: this file keeps its own local `projectRow()` + `openProjectScope()`
 * rather than the shared `sessionsSidebar()` page object, because every test
 * here drives the menu directly.
 *
 * SCOPE CHANGES NEVER SWITCH THE ACTIVE SESSION (BEHAVIOR CHANGE, deliberate,
 * 2026-08-27 — supersedes the old "picking a project also activates its most
 * recent session" reading). Checking or unchecking a project in the scope menu,
 * or clearing the scope via "All projects", only narrows or widens which
 * sessions the sidebar SHOWS; the active thread is never touched. A session
 * whose row the scope currently hides can still be the active one — assertions
 * below pin that by widening back to "All projects" and finding the original
 * active session's row still marked active, exactly as it was before scoping.
 * The scope is also multi-select now: checking an already-checked project
 * unchecks it (never a no-op), and two projects can be checked at once with
 * their sessions shown as a union.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { closeMenus } from '../helpers/tauri/menus.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { TOAST } from '../helpers/tauri/testids.js';
import { openBackgroundClient } from '../helpers/tauri/background-client.js';

const TAG_NAME = 'e2e-filter';

/** A project's checkbox item inside the (open) project scope menu. */
function projectRow(page: Page, projectId: string): Locator {
  return page.getByTestId(`sidebar-project-${projectId}`);
}

/** Open the header's project scope dropdown. */
async function openProjectScope(page: Page): Promise<void> {
  await page.getByTestId('sidebar-project-scope-trigger').click();
  await expect(page.getByTestId('sidebar-project-scope-menu')).toBeVisible({ timeout: 5_000 });
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

  test('"All projects" is checked by default and shows every session', async () => {
    const { page } = app;

    await openProjectScope(page);
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'checked');
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('data-state', 'unchecked');
    await expect(projectRow(page, projectB.projectId)).toHaveAttribute('data-state', 'unchecked');
    await closeMenus(page);

    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
  });

  test('checking a project narrows the list without switching the active session', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // `createTauriChat` selects each chat it creates, so B — created last — is the
    // active thread on entry.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await openProjectScope(page);
    await projectRow(page, projectA.projectId).click();
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'unchecked');
    await closeMenus(page);

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdA);
    // Scoping never activates a session: A's row is the only one visible, but it
    // is NOT active — B (now hidden by the scope) still is, underneath.
    // `ThreadListItemPrimitive.Root` only spreads `data-active="true"` for the
    // main thread; an inactive row carries no `data-active` attribute at all
    // (never `"false"`), so a not-true check is the correct negative here.
    await expect(rows.first()).not.toHaveAttribute('data-active', 'true');
  });

  test('clicking a checked project again unchecks it (multi-select toggle, never a no-op)', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Continuing from the previous test: the scope is {A}, one row visible.
    await expect(page.getByTestId('sessions-row')).toHaveCount(1, { timeout: 10_000 });

    await openProjectScope(page);
    await projectRow(page, projectA.projectId).click();
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'checked');
    await closeMenus(page);

    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
    // Definitive proof for the previous test's claim: B was the active thread
    // the whole time its row was hidden, and unchecking A (widening back to
    // "All") never had to switch anything to reveal it as active again.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('checking a second project adds it to the scope — a union, not a switch', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Continuing from the previous test: scope is empty, and B has been the
    // active thread since this describe block started — it has never moved,
    // through every scope change above.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await openProjectScope(page);
    await projectRow(page, projectA.projectId).click();
    await projectRow(page, projectB.projectId).click();
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('data-state', 'checked');
    await expect(projectRow(page, projectB.projectId)).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'unchecked');
    await closeMenus(page);

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    // Both sessions show as the union of the two checked projects, and the
    // active thread is still exactly B — checking either box never touched it.
    // (See the previous test for why this is `not.toHaveAttribute(..., 'true')`
    // rather than asserting `'false'`: the attribute is absent, not falsy.)
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
    await expect(sidebar.row(chatIdA)).not.toHaveAttribute('data-active', 'true');

    // Clear back to "All projects" for the tests that follow.
    await openProjectScope(page);
    await page.getByTestId('sidebar-project-all').click();
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'checked');
    await closeMenus(page);
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
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

  // Attention badges are driven by useUnreadStore.markUnread, which is only
  // called by the session-list-router on a `chat.notification` /
  // `permission.requested{notify:true}` WS event. Previously that event never
  // reached the client for a BACKGROUND chat (see the sessions-rows.spec.ts
  // unread-dot test for the root cause); now that chat.notification is
  // connection-global, project A's badge lights up while B stays active.
  //
  // A was backgrounded by sending from it and switching away before the reply
  // landed, which is a race the test lost whenever the machine was busy (rc.20,
  // rc.22, and locally under full-suite load — previously annotated here as a
  // hover-card flake). `openBackgroundClient` sends from a second daemon
  // connection instead, so A is never the active chat and there is nothing to
  // outrun.
  test('attention badges appear on a project item inside the scope menu', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await selectRow(page, sidebar.row(chatIdB));

    await openProjectScope(page);
    const badgeA = page.getByTestId(`sidebar-project-badge-${projectA.projectId}`);

    const background = await openBackgroundClient();
    try {
      background.send(chatIdA, 'What is 2 + 2? Reply with just the number.');

      // The menu stays open and mounted throughout — the badge is live React
      // state, not something that needs a reopen to pick up.
      await expect(badgeA).toBeVisible({ timeout: 45_000 });
      await expect(badgeA).toHaveText('1');
    } finally {
      background.close();
    }
    await closeMenus(page);

    // Selecting A's chat clears the unread flag, and with it the item's badge.
    await selectRow(page, sidebar.row(chatIdA));
    await openProjectScope(page);
    await expect(badgeA).toHaveCount(0, { timeout: 10_000 });
    await closeMenus(page);
  });

  test('synthetic has-pr/has-worktree chips render once a session carries one', async () => {
    // has-pr / has-worktree synthetic chips only render once hasSynthetic()
    // is true (a session with a real worktree path or a detected PR). Seeding
    // a worktree/PR is out of scope for a filter-bar UI spec — covered by the
    // dedicated git-branch/review-panel specs.
    test.skip(true, 'TODO(app-tauri): synthetic has-pr/has-worktree chips need a worktree/PR fixture');
  });

  test('the hover remove affordance removes the project after confirm, with a toast', async () => {
    const { page } = app;

    await openProjectScope(page);
    // Hover-revealed via CSS group-hover in a real browser — hover the item to
    // trigger the reveal, then dispatch the pointerdown its handler listens for
    // directly (its onSelect is stopped via stopPropagation, same as the
    // trigger's clear ✕, so a plain `.click()` would hit the checkbox instead).
    await projectRow(page, projectB.projectId).hover();
    await page.getByTestId(`sidebar-project-remove-${projectB.projectId}`).dispatchEvent('pointerdown');

    await expect(page.getByTestId('sessions-remove-project-dialog')).toBeVisible();
    await page.getByTestId('sessions-remove-project-dialog-confirm').click();

    await expect(projectRow(page, projectB.projectId)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(TOAST.root).filter({ hasText: 'Project removed' })).toBeVisible({
      timeout: 10_000,
    });
    await closeMenus(page);
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

    await openProjectScope(page);
    await projectRow(page, project.projectId).click();
    await closeMenus(page);

    const empty = page.getByTestId('sidebar-sessions-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toHaveText('No sessions match these filters.');
  });
});
