/**
 * §layout — Typed-surface engine (Chat/Workspace) specs for app-tauri browser mode.
 *
 * Cluster C, spec #20 of docs/plans/2026-07-03-tauri-e2e-test-plan.md, rewired for
 * the 2026-08-05 Files+Run merge: there are TWO surfaces now, so this covers the
 * surface rail, the dynamic floor, ⌘⇧C/⌘⇧W, the split controls, divider-drag resize,
 * in-workspace tab→pane-edge drag (center=join / edge=split), Escape-cancel, and
 * per-session layout persistence. All UI-only; no AI turns, no recording needed.
 *
 * Source read: packages/ui/src/layout/{SurfaceRail,SurfaceHost,SurfDivider,
 * WorkspaceEmptyState,WorkspaceTabStrip,WorkspaceStripChrome,WorkspaceTabPill,

 * packages/ui/src/layout/surfaces/WorkspaceSurface.tsx,
 * packages/ui/src/store/{layout,layout-placement,layout-persist,run-pane,
 * run-pane-file-tabs}.ts.
 *
 * Testid reference (all verified against source):
 *   surface-rail-<chat|workspace>   — rail toggles (disabled at the dynamic floor)
 *   chat-header / chat-header-hide / chat-header-split-right / chat-header-split-down
 *   chat-thread                     — chat surface body (T.thread)
 *   workspace-surface               — the merged surface root
 *   workspace-empty-state           — its inline picker card, shown while it has no tabs
 *   workspace-surface-close / -drag — hide the surface / its drag grip
 *   WORKSPACE.strip / .pane / .tab / .add — pane-id-keyed roots (see helpers/tauri/testids.ts)
 *   surf-divider-x / surf-divider-y — horizontal/vertical resize dividers
 *   file-picker-dialog / file-picker-input / file-picker-row-<path> — the file opener
 *   [data-surface="chat|workspace"] — the layout engine's pane containers; used
 *                                     here for pane bounding-box checks
 *
 * Pinned behaviour: hiding the workspace PRESERVES its tabs (the terminal cache
 * detaches without disposing), so a hide/show round-trip is asserted to bring
 * the tabs back. (The tab-drag and surface-drag gestures were deleted with the
 * surface-drag system, 2026-08-12.)
 *
 * Per-session layout persistence: `useLayoutStore.setActiveSession` is wired from
 * `useSessionListRouter` (called with `active.remoteId` on every session switch,
 * skipped for the `__LOCALID_*` draft) — see the last describe block.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar, composer, workspace } from '../helpers/tauri/page-objects.js';
import { WORKSPACE } from '../helpers/tauri/testids.js';

// ─── drag-gesture helpers (divider resizes) ───────────────────────────────────

/** Press the left button at `from` and nudge past the jitter threshold so the
 *  divider's pointer handler registers a real drag. Does NOT release. */
async function beginDrag(page: Page, from: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
}

/** Step the still-pressed pointer toward `to` in several intermediate moves, so
 *  the divider's pointermove handler samples the path rather than jumping
 *  straight to the end. */
async function moveDragTo(page: Page, to: { x: number; y: number }, steps = 6): Promise<void> {
  await page.mouse.move(to.x, to.y, { steps });
}

/** Open a file through the workspace's file picker (the empty-state card row, or a
 *  pane's `+` menu once it has tabs) and wait for its tab to land in the strip.
 *  `query` must match a substring of the seeded project file's name. */
async function openFileTab(page: Page, query: string): Promise<void> {
  await workspace(page).openFilePicker();
  await page.getByTestId('file-picker-dialog').waitFor({ timeout: 5_000 });
  await page.getByTestId('file-picker-input').fill(query);
  const row = page.locator('[data-testid^="file-picker-row-"]').filter({ hasText: query }).first();
  await row.waitFor({ timeout: 5_000 });
  await row.click();
  await page.locator(WORKSPACE.tab).first().waitFor({ timeout: 5_000 });
}

/**
 * Open a file and make its tab PERMANENT.
 *
 * `run-pane-file-tabs.ts` gives each pane ONE preview slot per launch scope, so a
 * second picker-opened file REPLACES the first instead of appending — a stack of
 * files needs each one promoted (double-click, same as the app's own gesture)
 * before the next is opened.
 */
async function openPermanentFileTab(page: Page, query: string): Promise<void> {
  await openFileTab(page, query);
  const tab = workspace(page).tab(query);
  await tab.dblclick();
  await expect(tab).toHaveCount(1);
}

// ─── §20a Surface rail, dynamic floor, ⌘⇧C/⌘⇧W shortcuts ───────────────────────
//
// registry.ts's surface toggles are `workspace.toggle-chat` (⌘⇧C) and
// `workspace.toggle-workspace` (⌘⇧W), each wired via `useShortcutAction` in
// SurfaceHost.tsx. The digit chords ⌘1…⌘9 no longer touch surfaces — they
// switch session tabs (`sessions.tab-by-index`) — so pressing ⌘2 here is a
// pure no-op, not a workspace toggle.

test.describe('§20 layout — surface rail, floor, shortcuts', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('Chat is the only lit surface at boot and is disabled at the dynamic floor', async () => {
    const { page } = app;
    await expect(page.getByTestId('chat-thread')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('surface-rail-chat')).toBeDisabled();
    await expect(page.getByTestId('surface-rail-workspace')).toBeEnabled();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
  });

  test('the rail button toggles the workspace on, joining Chat in the top row', async () => {
    const { page } = app;
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });
    // Two surfaces are lit now, so Chat is no longer at the floor.
    await expect(page.getByTestId('surface-rail-chat')).toBeEnabled();
    // With no tabs it shows the empty-state card, not a tab strip.
    await expect(page.getByTestId('workspace-empty-state')).toBeVisible();
    await expect(page.locator(WORKSPACE.strip)).toHaveCount(0);
  });

  test('ControlOrMeta+Shift+W toggles the workspace off; Chat is once again the sole lit surface', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+Shift+W');
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    await expect(page.getByTestId('surface-rail-chat')).toBeDisabled();
  });

  test('ControlOrMeta+Shift+W turns the workspace back on', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+Shift+W');
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });
  });

  test('the last lit surface cannot be toggled off (the workspace becomes the floor once Chat is hidden)', async () => {
    const { page } = app;
    // litCount=2 here, so hiding Chat (via its header control) is allowed.
    await page.getByTestId('chat-header-hide').click();
    await expect(page.getByTestId('chat-header')).toHaveCount(0);

    // The workspace is now the ONLY lit surface — its rail button and its own
    // close button are both disabled (the dynamic floor). The close button exists
    // even on an empty workspace: the empty-state header composes the same
    // WorkspaceStripActions the tab strip does.
    await expect(page.getByTestId('surface-rail-workspace')).toBeDisabled();
    await expect(page.getByTestId('workspace-surface-close')).toBeDisabled();

    // A shortcut aimed at the floor surface is a no-op, not a crash.
    await page.keyboard.press('ControlOrMeta+Shift+W');
    await expect(page.getByTestId('workspace-surface')).toBeVisible();

    // Restore Chat via the rail so later tests in this file start from a normal state.
    await page.getByTestId('surface-rail-chat').click();
    await expect(page.getByTestId('chat-header')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── §20b Splits + divider-drag resize ──────────────────────────────────────────

test.describe('§20 layout — splits + divider resize', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('chat-header split-right adds the workspace beside Chat in the top row', async () => {
    const { page } = app;
    await page.getByTestId('chat-header-split-right').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-surface="chat"]').boundingBox();
    const wsBox = await page.locator('[data-surface="workspace"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(wsBox).not.toBeNull();
    // Same row (top-row split): comparable y, Chat stays leftmost.
    expect(Math.abs(chatBox!.y - wsBox!.y)).toBeLessThan(5);
    expect(chatBox!.x).toBeLessThan(wsBox!.x);
  });

  test('with the workspace already placed, no split controls render anywhere', async () => {
    const { page } = app;
    // The strip's split buttons were deleted outright (they could only render
    // while the workspace was placed — exactly when layoutCanSplit() is false).
    // The chat header's split stays conditional and must be hidden here too.
    await expect(page.getByTestId('workspace-tab-strip-split-right')).toHaveCount(0);
    await expect(page.getByTestId('workspace-tab-strip-split-down')).toHaveCount(0);
    await expect(page.getByTestId('chat-header-split-right')).toHaveCount(0);
  });

  test('dragging the horizontal divider resizes the top-row split, and the fraction sticks across a re-render', async () => {
    const { page } = app;
    const box = await page.getByTestId('surf-divider-x').boundingBox();
    if (!box) throw new Error('surf-divider-x has no bounding box');
    const wsBefore = await page.locator('[data-surface="workspace"]').boundingBox();
    if (!wsBefore) throw new Error('workspace pane has no bounding box');

    await beginDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await moveDragTo(page, { x: box.x + box.width / 2 + 120, y: box.y + box.height / 2 });
    await page.mouse.up();

    const wsAfter = await page.locator('[data-surface="workspace"]').boundingBox();
    if (!wsAfter) throw new Error('workspace pane has no bounding box after drag');
    expect(Math.abs(wsAfter.width - wsBefore.width)).toBeGreaterThan(30);

    // Trigger an unrelated re-render (open + close the file picker) and confirm the
    // dragged fraction still applies — it's stored in the layout store, not a
    // transient drag-only visual.
    await workspace(page).openFilePicker();
    await page.getByTestId('file-picker-dialog').waitFor({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('file-picker-dialog')).toHaveCount(0);

    const wsAfterRerender = await page.locator('[data-surface="workspace"]').boundingBox();
    if (!wsAfterRerender) throw new Error('workspace pane has no bounding box after re-render');
    expect(Math.abs(wsAfterRerender.width - wsAfter.width)).toBeLessThan(3);
  });

  test('chat-header split-down moves the workspace to the bottom strip, and its divider resizes the rows', async () => {
    const { page } = app;
    // Hide the workspace first so `layoutCanSplit` is true again and chat's own
    // split-down is offered; split-down then places it in the bottom slot.
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    await page.getByTestId('chat-header-split-down').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-surface="chat"]').boundingBox();
    const wsBox = await page.locator('[data-surface="workspace"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(wsBox).not.toBeNull();
    // The workspace sits below the top row (allow the divider's own gutter height).
    expect(wsBox!.y).toBeGreaterThan(chatBox!.y + chatBox!.height - 5);

    const box = await page.getByTestId('surf-divider-y').boundingBox();
    if (!box) throw new Error('surf-divider-y has no bounding box');
    await beginDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await moveDragTo(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 - 90 });
    await page.mouse.up();

    const wsAfter = await page.locator('[data-surface="workspace"]').boundingBox();
    if (!wsAfter) throw new Error('workspace pane has no bounding box after drag');
    expect(Math.abs(wsAfter.height - wsBox!.height)).toBeGreaterThan(25);
  });

  test('closing the non-floor workspace leaves Chat alone, and re-showing it brings its tabs back', async () => {
    const { page } = app;
    // The previous test left the workspace docked in the bottom strip, where the
    // empty-state card's rows overflow the short strip and can't be clicked. Re-light
    // it so `placeInLayout` puts it back in the top row at full height.
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-empty-state')).toBeVisible({ timeout: 5_000 });

    // Give the workspace a tab first: hiding is not closing, so the tab must survive.
    await openFileTab(page, 'index.ts');
    await expect(workspace(page).tabs()).toHaveCount(1);

    await page.getByTestId('workspace-surface-close').click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
    await expect(page.getByTestId('chat-thread')).toBeVisible();

    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });
    await expect(workspace(page).tabs()).toHaveCount(1);
  });
});

// ─── §20c Drag: workspace tab → pane edge (center=join / edge=split) + Escape ──
//
// Cross-surface tab adoption died with the merge (there is no second surface to
// adopt into), so what remains is reshaping panes WITHIN the workspace:
// `moveTabToPaneEdge` — center joins pane 1, an edge splits into a second pane.
// It is a no-op on the surface's last remaining tab (nothing to split against),
// which is why this block opens two files.

test.describe('§20 layout — drag: workspace tab to a pane edge, and escape-cancel', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    const { page } = app;
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });
    // The first tab must be promoted or the second file just replaces it in the
    // pane's single preview slot.
    await openPermanentFileTab(page, 'index.ts');
    await openFileTab(page, 'CLAUDE.md');
    await expect(workspace(page).tabs()).toHaveCount(2);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // (The tab-drag and surface-grip reposition cases lived here until the
  // surface-drag system was deleted, 2026-08-12 — no gesture moves surfaces or
  // splits panes anymore; re-add coverage with whatever replaces it.)
});

// ─── §20d Per-session layout persistence ────────────────────────────────────────

test.describe('§20 layout — per-session layout persistence', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatA: string;
  let chatB: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // Both chats created in beforeAll (never mid-test) to dodge the known
    // useSessionListRouter navigation race documented across this suite.
    chatA = await createTauriChat(app.page, project.projectId, 'default');
    chatB = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('arranging a layout in session A does not leak into session B, and A is restored on return', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Arrange: open chat A, toggle the workspace on.
    await sidebar.row(chatA).click();
    await composer(page).input().waitFor({ timeout: 10_000 });
    await page.getByTestId('surface-rail-workspace').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    // Switch to session B — should show the DEFAULT layout (Chat only).
    await sidebar.row(chatB).click();
    await composer(page).input().waitFor({ timeout: 10_000 });
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);

    // Switch back to A — the arranged layout should be restored.
    await sidebar.row(chatA).click();
    await composer(page).input().waitFor({ timeout: 10_000 });
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });
  });
});
