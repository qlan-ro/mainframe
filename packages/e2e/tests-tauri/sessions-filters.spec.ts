/**
 * §sessions-filters — Sessions sidebar project SCOPE strip + tag filter menu +
 * sort menu + empty-state specs for app-tauri browser mode.
 *
 * Ported from plan spec #3 (docs/plans/2026-07-03-tauri-e2e-test-plan.md,
 * Cluster A). All tests run in E2E_MODE=mock (no AI turn needed — these are
 * UI-only sidebar interactions over REST-seeded projects/chats).
 *
 * Retargeted for the shell redesign (docs/plans/2026-10-04-mainframe-redesign-adoption.md,
 * D14/D15): `ProjectScopeSelector`'s header dropdown trigger is GONE, replaced by
 * `ScopeStrip.tsx` — a row of stacked avatars built on a Radix `ToggleGroup
 * type="multiple"`, always visible (no open/close step). Scope, not switcher: any
 * number of avatars can be toggled on and the sessions list shows their union; an
 * empty scope means "All projects" (there is no explicit "All projects" item —
 * clearing means toggling every avatar off). The footer's tag chip wall is also
 * gone, replaced by a menu on the first group header (`SessionsFilterMenu.tsx`).
 *
 * Testid reference (verified against packages/ui/src/features/sessions/{ScopeStrip,
 * SessionsFilterMenu}.tsx):
 *   sessions-scope-strip              — the strip root (always mounted, in the sidebar header)
 *   sessions-scope-avatar-<projectId> — one project's `ToggleGroupItem`; `data-state`
 *                                       reports "on"/"off" (Radix Toggle, not a checkbox —
 *                                       NOT "checked"/"unchecked"). Click toggles it in/out
 *                                       of scope; ⌥-click solos it (toggles every other
 *                                       avatar off); right-click opens a context menu with
 *                                       "Remove project" (`sidebar-project-remove-<id>`)
 *   sessions-scope-more                — "+N" once past six avatars
 *   sessions-scope-label                — "All projects" (empty scope) or "N of M" + the
 *                                       scoped names, faded
 *   sessions-scope-add                  — the strip's trailing "+" add-project button
 *   sidebar-project-remove-<id>        — the avatar's context-menu "Remove project" item (id survives)
 *   sessions-remove-project-dialog / -confirm / -cancel — in-app confirm dialog
 *                                       (ConfirmDialogHost → ConfirmDialog, testid from
 *                                       use-remove-project.ts's requestConfirm)
 *   sessions-filter-button             — the tag-filter trigger on the first group header
 *                                       (funnel glyph; ALWAYS rendered, even with no tags in use)
 *   sessions-tag-filter-bar            — the filter dropdown's content root (mounted only
 *                                       while open — a Radix `DropdownMenuContent`)
 *   sessions-tag-filter-<name>         — a tag's `DropdownMenuCheckboxItem` inside the menu;
 *                                       `data-state` reports "checked"/"unchecked" (this one
 *                                       IS a checkbox primitive); picking one does NOT close
 *                                       the menu (multi-select)
 *   sessions-tag-filter-synthetic-<kind> — has-pr/has-worktree checkbox item
 *   sessions-tag-filter-clear          — menu item that clears every active tag filter
 *   sessions-filter-chip               — the one active-filter chip beside the button (the
 *                                       lone tag's name, or "N filters"); click clears it
 *   sessions-row-action-tags           — row hover action that opens the TagPopover
 *   sessions-tag-popover               — TagPopover content root
 *   sessions-tag-popover-search        — TagPopover search/create input
 *   sessions-sort-button               — "Sort by" trigger, on the parked list header (unchanged)
 *   sessions-sort-popover               — sort menu content (unchanged)
 *   sessions-sort-<recent|name|status|project> — sort radio items (unchanged)
 *   sessions-section-jump              — the PARKED first-group header. The first group's
 *                                       label is drawn here (SidebarJumpSection), and
 *                                       `SessionListVirtuoso` deliberately renders a hairline
 *                                       instead of a duplicate header for group 0 — so
 *                                       `sessions-group-header-<label>` exists only for the
 *                                       SECOND group onward, and the sort-mode label has to
 *                                       be read off the parked header.
 *   sidebar-sessions-empty             — empty-list message (unchanged)
 *   directory-picker / directory-picker-cancel — DirectoryPickerModal (add-project flow)
 *   TOAST.root (helpers/tauri/testids.ts) — native sonner toast; WsToastCard is gone
 *
 * DROPPED, no successor (D14 — capability intentionally removed, not moved):
 * the scope dropdown's per-project attention badge (`sidebar-project-badge-<id>`),
 * its "Unavailable" badge (`sidebar-project-unavailable-<id>`), and the
 * trigger's own hidden-attention badge (`sidebar-project-scope-badge`). Row
 * status already shows waiting ("your turn"); unavailable projects render
 * dimmed with a tooltip instead of a badge. The "attention badges appear on a
 * project item inside the scope menu" scenario is deleted below with this note.
 *
 * SCOPE CHANGES NEVER SWITCH THE ACTIVE SESSION (BEHAVIOR CHANGE, deliberate,
 * 2026-08-27 — supersedes the old "picking a project also activates its most
 * recent session" reading, and unaffected by the redesign). Toggling a project's
 * avatar in/out of scope only narrows or widens which sessions the sidebar
 * SHOWS; the active thread is never touched. A session whose row the scope
 * currently hides can still be the active one — assertions below pin that by
 * widening back to "All projects" and finding the original active session's
 * row still marked active, exactly as it was before scoping. The scope is also
 * multi-select: toggling an already-scoped project off is never a no-op, and
 * two projects can be scoped at once with their sessions shown as a union.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { closeMenus } from '../helpers/tauri/menus.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { TOAST } from '../helpers/tauri/testids.js';

const TAG_NAME = 'e2e-filter';

/** A project's avatar inside the (always-mounted) scope strip. */
function scopeAvatar(page: Page, projectId: string): Locator {
  return page.getByTestId(`sessions-scope-avatar-${projectId}`);
}

function scopeLabel(page: Page): Locator {
  return page.getByTestId('sessions-scope-label');
}

/** Open the first group header's tag-filter dropdown. */
async function openTagFilter(page: Page): Promise<void> {
  await page.getByTestId('sessions-filter-button').click();
  await expect(page.getByTestId('sessions-tag-filter-bar')).toBeVisible({ timeout: 5_000 });
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

// ─── §sessions-filters Project scope strip + tag filter menu + sort menu ─────

test.describe('§sessions-filters Project scope + tag filter menu', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;
  let chatIdA: string;
  let chatIdB: string;

  test.beforeAll(async () => {
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

  test('an empty scope ("All projects") shows every session', async () => {
    const { page } = app;

    await expect(scopeAvatar(page, projectA.projectId)).toHaveAttribute('data-state', 'off');
    await expect(scopeAvatar(page, projectB.projectId)).toHaveAttribute('data-state', 'off');
    await expect(scopeLabel(page)).toHaveText('All projects');

    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
  });

  test('toggling a project avatar narrows the list without switching the active session', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // `createTauriChat` selects each chat it creates, so B — created last — is the
    // active thread on entry.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await scopeAvatar(page, projectA.projectId).click();
    await expect(scopeAvatar(page, projectA.projectId)).toHaveAttribute('data-state', 'on');
    await expect(scopeLabel(page)).toContainText('1 of 2');

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

  test('toggling a scoped project again clears it back to "All projects" (never a no-op)', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Continuing from the previous test: the scope is {A}, one row visible.
    await expect(page.getByTestId('sessions-row')).toHaveCount(1, { timeout: 10_000 });

    await scopeAvatar(page, projectA.projectId).click();
    await expect(scopeAvatar(page, projectA.projectId)).toHaveAttribute('data-state', 'off');
    await expect(scopeLabel(page)).toHaveText('All projects');

    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
    // Definitive proof for the previous test's claim: B was the active thread
    // the whole time its row was hidden, and clearing A's scope (widening back
    // to "All") never had to switch anything to reveal it as active again.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('toggling a second project adds it to the scope — a union, not a switch', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Continuing from the previous test: scope is empty, and B has been the
    // active thread since this describe block started — it has never moved,
    // through every scope change above.
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    await scopeAvatar(page, projectA.projectId).click();
    await scopeAvatar(page, projectB.projectId).click();
    await expect(scopeAvatar(page, projectA.projectId)).toHaveAttribute('data-state', 'on');
    await expect(scopeAvatar(page, projectB.projectId)).toHaveAttribute('data-state', 'on');
    await expect(scopeLabel(page)).toContainText('2 of 2');

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    // Both sessions show as the union of the two scoped projects, and the
    // active thread is still exactly B — scoping either one never touched it.
    // (See the previous test for why this is `not.toHaveAttribute(..., 'true')`
    // rather than asserting `'false'`: the attribute is absent, not falsy.)
    await expect(sidebar.row(chatIdB)).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
    await expect(sidebar.row(chatIdA)).not.toHaveAttribute('data-active', 'true');

    // Clear back to "All projects" for the tests that follow.
    await scopeAvatar(page, projectA.projectId).click();
    await scopeAvatar(page, projectB.projectId).click();
    await expect(scopeLabel(page)).toHaveText('All projects');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
  });

  test('⌥-click solos a project — every other avatar toggles off', async () => {
    const { page } = app;

    // Start from a multi-project scope so the solo has something to clear.
    await scopeAvatar(page, projectA.projectId).click();
    await scopeAvatar(page, projectB.projectId).click();
    await expect(scopeLabel(page)).toContainText('2 of 2');

    await scopeAvatar(page, projectB.projectId).click({ modifiers: ['Alt'] });
    await expect(scopeAvatar(page, projectA.projectId)).toHaveAttribute('data-state', 'off');
    await expect(scopeAvatar(page, projectB.projectId)).toHaveAttribute('data-state', 'on');
    await expect(scopeLabel(page)).toContainText('1 of 2');

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdB);

    // Clear back to "All projects" for the tests that follow.
    await scopeAvatar(page, projectB.projectId).click();
    await expect(scopeLabel(page)).toHaveText('All projects');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
  });

  test('the add-project action opens the directory picker', async () => {
    const { page } = app;

    // The dashed "Add project" pill and the dropdown's own "Add project" menu
    // item are both gone with ProjectScopeSelector; the affordance is the scope
    // strip's own trailing "+" (ScopeStrip.tsx).
    await page.getByTestId('sessions-scope-add').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('directory-picker-cancel').click();
    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });

  // The old footer `TagFilterBar` mounted only once a tag was in use. Its
  // successor, `SessionsFilterMenu`, is a permanent header control (the funnel
  // button always renders; an empty dropdown is just "no tags yet") — there is
  // no more "absent until a tag exists" state to pin, so that scenario is
  // deleted rather than retargeted.

  test('applying a tag to a session surfaces it in the tag filter menu', async () => {
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

    await openTagFilter(page);
    const tagItem = page.getByTestId(`sessions-tag-filter-${TAG_NAME}`);
    await expect(tagItem).toBeVisible();
    await expect(tagItem).toHaveAttribute('data-state', 'unchecked');
    await closeMenus(page);
  });

  test('picking a tag in the menu filters the session list and shows the chip', async () => {
    const { page } = app;

    await openTagFilter(page);
    const tagItem = page.getByTestId(`sessions-tag-filter-${TAG_NAME}`);
    await tagItem.click();
    await expect(tagItem).toHaveAttribute('data-state', 'checked');
    // Multi-select: picking a tag does NOT close the menu.
    await expect(page.getByTestId('sessions-tag-filter-bar')).toBeVisible();
    await closeMenus(page);

    const rows = page.getByTestId('sessions-row');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute('data-chat-id', chatIdA);

    const chip = page.getByTestId('sessions-filter-chip');
    await expect(chip).toHaveText(TAG_NAME);

    // The chip itself clears the filter.
    await chip.click();
    await expect(page.getByTestId('sessions-filter-chip')).toHaveCount(0);
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

  // DELETED (D14 — capability dropped, not moved): the scope dropdown's
  // per-project attention badge no longer exists. The scope strip carries no
  // badge of its own — a project with a waiting session is only visible via
  // that session's own row status ("your turn"), which sessions-rows.spec.ts
  // already covers. There is nothing left in the scope strip for this
  // scenario to assert.

  test('synthetic has-pr/has-worktree chips render once a session carries one', async () => {
    // has-pr / has-worktree synthetic items only render once hasSynthetic()
    // is true (a session with a real worktree path or a detected PR). Seeding
    // a worktree/PR is out of scope for a filter-menu UI spec — covered by the
    // dedicated git-branch/review-panel specs. Now lives in the tag filter
    // menu as `sessions-tag-filter-synthetic-<kind>` rather than a footer chip.
    test.skip(true, 'TODO(app-tauri): synthetic has-pr/has-worktree chips need a worktree/PR fixture');
  });

  test('right-clicking an avatar and removing the project asks for confirmation, then toasts', async () => {
    const { page } = app;

    await scopeAvatar(page, projectB.projectId).click({ button: 'right' });
    await page.getByTestId(`sidebar-project-remove-${projectB.projectId}`).click();

    await expect(page.getByTestId('sessions-remove-project-dialog')).toBeVisible();
    await page.getByTestId('sessions-remove-project-dialog-confirm').click();

    await expect(scopeAvatar(page, projectB.projectId)).toHaveCount(0, { timeout: 10_000 });
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

    await scopeAvatar(page, project.projectId).click();

    const empty = page.getByTestId('sidebar-sessions-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toHaveText('No sessions match these filters.');
  });
});
