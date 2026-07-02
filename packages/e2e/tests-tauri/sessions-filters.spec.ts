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
 *   app-status-bar                    — status bar (getByText 'Daemon Connected')
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';

const TAG_NAME = 'e2e-filter';

/** Wait for the status bar to show Daemon Connected (used after reload). */
async function waitConnected(page: Page): Promise<void> {
  await page
    .locator('[data-testid="app-status-bar"]')
    .getByText('Daemon Connected', { exact: true })
    .waitFor({ timeout: 20_000 });
}

// ─── §sessions-filters Project pill bar + tag filter bar + sort menu ─────────

test.describe('§sessions-filters Project + tag filter bar', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;
  let chatIdA: string;
  let chatIdB: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
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

    await expect(page.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.projectFilterPill(projectA.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(sidebar.projectFilterPill(projectB.projectId)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('sessions-row')).toHaveCount(2, { timeout: 10_000 });
  });

  test("clicking a project pill filters the list AND activates that project's session", async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

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
    const pillWrap = page.getByTestId(`sessions-filter-pill-${projectA.projectId}-wrap`);

    await pillWrap.hover();
    const dismissBtn = page.getByTestId('sessions-pill-hint-dismiss');
    await expect(dismissBtn).toBeVisible({ timeout: 10_000 });
    await dismissBtn.click();

    await page.reload();
    await waitConnected(page);

    await sidebar.projectFilterPill(projectA.projectId).waitFor({ timeout: 10_000 });
    await page.getByTestId(`sessions-filter-pill-${projectA.projectId}-wrap`).hover();
    // Dismissed hints render the bare child — the tooltip infrastructure (and
    // its dismiss button) is never mounted, so this is a structural absence,
    // not a timing race.
    await expect(page.getByTestId('sessions-pill-hint-dismiss')).toHaveCount(0);
  });

  test('right-click menu shows Rename disabled and Remove enabled', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

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

  test('attention badges appear on non-filtered pills', async () => {
    // Attention badges are driven by useUnreadStore.markUnread, which is only
    // called by the session-list-router on a `chat.notification` /
    // `permission.requested{notify:true}` WS event — i.e. a real agent turn.
    // No existing recording produces that state against a background
    // (non-active) chat while another chat stays active. Skipping rather than
    // faking the unread flag from the test.
    test.skip(true, 'TODO(recording): attention badges need a chat.notification event on a background chat');
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
