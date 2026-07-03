/**
 * §layout — Typed-surface engine (Chat/Files/Run) specs for app-tauri browser mode.
 *
 * Cluster C, spec #20 of docs/plans/2026-07-03-tauri-e2e-test-plan.md. New surface
 * (no legacy 1:1 predecessor) — covers the surface rail, the dynamic floor,
 * ⌘1/2/3 shortcuts, split controls, divider-drag resize, Files-tab→Run drag
 * (center=join / edge=split), Escape-cancel, and per-session layout persistence.
 * All UI-only; no AI turns, no recording needed.
 *
 * Source read: packages/ui/src/layout/{SurfaceRail,SurfaceHost,SurfDivider,
 * SurfacePicker,FilesTabStrip,RunTabStrip,use-surface-drag,SurfaceDragLayer}.tsx,
 * packages/ui/src/layout/surfaces/{RunSurface,FilesSurface}.tsx,
 * packages/ui/src/store/{layout,layout-persist,run-pane}.ts.
 *
 * Testid reference (all verified against source):
 *   surface-rail-<chat|files|run>   — rail toggle buttons (disabled at the dynamic floor)
 *   chat-header / chat-header-hide / chat-header-split-right / chat-header-split-down
 *   chat-thread                     — chat surface body (T.thread)
 *   files-surface / files-surface-picker (empty state) / files-tab-strip
 *   files-tab-strip-add / -split-right / -split-down / -close
 *   run-surface / run-surface-picker (empty state) / run-surface-close
 *   run-tab-strip-split-right / -split-down
 *   run-pane-<paneId>               — each Run pane (prefix-matched; id is opaque)
 *   surf-divider-x / surf-divider-y — horizontal/vertical resize dividers
 *   surface-drag-layer              — ghost + drop-zone overlay, mounted only mid-drag
 *   drop-zone-<center|left|right|top|bottom> — drop-zone highlight (keyed by EDGE only,
 *                                     not by target surface — see SurfaceDragLayer.tsx)
 *   file-picker-dialog / file-picker-input / file-picker-row-<path> — Cmd+P file opener
 *   [data-drop-surface="chat|files|run"] — the layout engine's own hit-test region
 *                                     attribute; used here for pane bounding-box checks
 *                                     (the same attribute SurfaceDragLayer hit-tests via
 *                                     elementFromPoint, so it's the correct anchor for
 *                                     both "where is this pane" and "where do I drop").
 *
 * KNOWN GAP found during research (see the last describe block): `useLayoutStore
 * .setActiveSession` — the hook that would key layout/run state by chat id — is never
 * called from application runtime code (grepped `packages/ui/src`; only
 * `store/__tests__/layout*.test.ts` call it). Per-session persistence is implemented at
 * the store layer but not wired to real session switching, so that scenario is written
 * but `test.skip`-ped with a TODO rather than faked.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar, composer } from '../helpers/tauri/page-objects.js';

// ─── drag-gesture helpers ──────────────────────────────────────────────────────
// Pointer-driven (not HTML5 DnD) — mirrors use-surface-drag.ts's own model: a
// window pointermove/pointerup pair, with a 4px jitter threshold before a drag
// is treated as real. Real `page.mouse` events so the SUT's own
// `document.elementFromPoint` hit-testing resolves drop zones exactly as it
// would for a live user drag.

/** Press the left button at `from` and move past the 4px jitter threshold so the
 *  drag store (DRAG_THRESHOLD_PX in use-surface-drag.ts) registers a real drag.
 *  Does NOT release the button. */
async function beginDrag(page: Page, from: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
}

/** Step the still-pressed pointer toward `to` in several intermediate moves, so
 *  SurfaceDragLayer's pointermove listener samples the path (and resolves a drop
 *  zone via elementFromPoint) rather than jumping straight to the end. */
async function moveDragTo(page: Page, to: { x: number; y: number }, steps = 6): Promise<void> {
  await page.mouse.move(to.x, to.y, { steps });
}

/** Open a file via the Cmd+P-style file picker (Files "+" trigger) and wait for
 *  its tab to land in the Files tab strip. `query` must match a substring of the
 *  seeded project file's name (e.g. 'index.ts', 'CLAUDE.md'). */
async function openFileTab(page: Page, query: string): Promise<void> {
  await page.getByTestId('files-tab-strip-add').click();
  await page.getByTestId('file-picker-dialog').waitFor({ timeout: 5_000 });
  await page.getByTestId('file-picker-input').fill(query);
  const row = page.locator('[data-testid^="file-picker-row-"]').filter({ hasText: query }).first();
  await row.waitFor({ timeout: 5_000 });
  await row.click();
  await page.locator('[data-testid="files-tab-strip"]').getByRole('tab').first().waitFor({ timeout: 5_000 });
}

// ─── §20a Surface rail, dynamic floor, ⌘1/2/3 shortcuts ────────────────────────

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
    await expect(page.getByTestId('surface-rail-files')).toBeEnabled();
    await expect(page.getByTestId('surface-rail-run')).toBeEnabled();
    await expect(page.getByTestId('files-surface')).toHaveCount(0);
    await expect(page.getByTestId('run-surface')).toHaveCount(0);
  });

  test('the rail button toggles Files on, joining Chat in the top row', async () => {
    const { page } = app;
    await page.getByTestId('surface-rail-files').click();
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });
    // Two surfaces are lit now, so Chat is no longer at the floor.
    await expect(page.getByTestId('surface-rail-chat')).toBeEnabled();
  });

  test('ControlOrMeta+2 toggles Files off; Chat is once again the sole lit surface', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page.getByTestId('files-surface')).toHaveCount(0);
    await expect(page.getByTestId('surface-rail-chat')).toBeDisabled();
  });

  test('ControlOrMeta+2 turns Files back on; ControlOrMeta+3 adds Run to the bottom strip', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('ControlOrMeta+3');
    await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 5_000 });
  });

  test('the last lit surface cannot be toggled off (Files becomes the floor after Chat and Run are hidden)', async () => {
    const { page } = app;
    // litCount=3 here, so hiding Chat (via its header control) is allowed.
    await page.getByTestId('chat-header-hide').click();
    await expect(page.getByTestId('chat-header')).toHaveCount(0);
    // litCount=2 now, so closing Run is allowed too. Run has never had a tab
    // opened in it (no launch/terminal in this describe block), so it renders
    // the empty `run-surface-picker` (layout/surfaces/RunSurface.tsx `hasContent`
    // gate) rather than a `RunTabStrip` — `run-surface-close` only exists once
    // Run has content, so the reachable close path here is the rail toggle
    // (same `toggleSurface('run')` action as the tab-strip close button).
    await page.getByTestId('surface-rail-run').click();
    await expect(page.getByTestId('run-surface')).toHaveCount(0);

    // Files is now the ONLY lit surface — its rail button and its own close button
    // are disabled (the dynamic floor).
    await expect(page.getByTestId('surface-rail-files')).toBeDisabled();
    await expect(page.getByTestId('files-tab-strip-close')).toBeDisabled();

    // A shortcut aimed at the floor surface is a no-op, not a crash.
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page.getByTestId('files-surface')).toBeVisible();

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

  test('chat-header split-right adds Files beside Chat in the top row', async () => {
    const { page } = app;
    await page.getByTestId('chat-header-split-right').click();
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-drop-surface="chat"]').boundingBox();
    const filesBox = await page.locator('[data-drop-surface="files"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(filesBox).not.toBeNull();
    // Same row (top-row split): comparable y, Chat stays leftmost.
    expect(Math.abs(chatBox!.y - filesBox!.y)).toBeLessThan(5);
    expect(chatBox!.x).toBeLessThan(filesBox!.x);
  });

  test('files-tab-strip split-down adds Run to the bottom strip', async () => {
    const { page } = app;
    await page.getByTestId('files-tab-strip-split-down').click();
    await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 5_000 });

    const filesBox = await page.locator('[data-drop-surface="files"]').boundingBox();
    const runBox = await page.locator('[data-drop-surface="run"]').boundingBox();
    expect(filesBox).not.toBeNull();
    expect(runBox).not.toBeNull();
    // Run sits below the top row (allow the divider's own gutter height).
    expect(runBox!.y).toBeGreaterThan(filesBox!.y + filesBox!.height - 5);
  });

  test('dragging the horizontal divider resizes the top-row split, and the fraction sticks across a re-render', async () => {
    const { page } = app;
    const box = await page.getByTestId('surf-divider-x').boundingBox();
    if (!box) throw new Error('surf-divider-x has no bounding box');
    const filesBefore = await page.locator('[data-drop-surface="files"]').boundingBox();
    if (!filesBefore) throw new Error('files pane has no bounding box');

    await beginDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await moveDragTo(page, { x: box.x + box.width / 2 + 120, y: box.y + box.height / 2 });
    await page.mouse.up();

    const filesAfter = await page.locator('[data-drop-surface="files"]').boundingBox();
    if (!filesAfter) throw new Error('files pane has no bounding box after drag');
    expect(Math.abs(filesAfter.width - filesBefore.width)).toBeGreaterThan(30);

    // Trigger an unrelated re-render (open + close the file picker) and confirm the
    // dragged fraction still applies — it's stored in the layout store, not a
    // transient drag-only visual.
    await page.getByTestId('files-tab-strip-add').click();
    await page.getByTestId('file-picker-dialog').waitFor({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('file-picker-dialog')).toHaveCount(0);

    const filesAfterRerender = await page.locator('[data-drop-surface="files"]').boundingBox();
    if (!filesAfterRerender) throw new Error('files pane has no bounding box after re-render');
    expect(Math.abs(filesAfterRerender.width - filesAfter.width)).toBeLessThan(3);
  });

  test('dragging the vertical divider resizes the top row against the bottom strip', async () => {
    const { page } = app;
    const box = await page.getByTestId('surf-divider-y').boundingBox();
    if (!box) throw new Error('surf-divider-y has no bounding box');
    const filesBefore = await page.locator('[data-drop-surface="files"]').boundingBox();
    if (!filesBefore) throw new Error('files pane has no bounding box');

    await beginDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await moveDragTo(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 - 90 });
    await page.mouse.up();

    const filesAfter = await page.locator('[data-drop-surface="files"]').boundingBox();
    if (!filesAfter) throw new Error('files pane has no bounding box after drag');
    expect(Math.abs(filesAfter.height - filesBefore.height)).toBeGreaterThan(25);
  });

  test('closing a non-floor surface removes only its pane', async () => {
    const { page } = app;
    // litCount is 3 (chat, files, run) here, so Files is not at the floor.
    await page.getByTestId('files-tab-strip-close').click();
    await expect(page.getByTestId('files-surface')).toHaveCount(0);
    await expect(page.getByTestId('chat-thread')).toBeVisible();
    await expect(page.getByTestId('run-surface')).toBeVisible();
  });
});

// ─── §20c Drag: Files-tab-to-Run (center=join / edge=split) + Escape-cancel ────

test.describe('§20 layout — drag: Files-tab-to-Run and escape-cancel', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    const { page } = app;
    await page.getByTestId('surface-rail-files').click();
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('surface-rail-run').click();
    await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 5_000 });
    await openFileTab(page, 'index.ts');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('dragging a Files tab onto the center of Run joins it as a Run tab', async () => {
    const { page } = app;
    const filesTab = page.locator('[data-testid="files-tab-strip"]').getByRole('tab').first();
    const tabBox = await filesTab.boundingBox();
    if (!tabBox) throw new Error('files tab has no bounding box');
    const runBox = await page.locator('[data-drop-surface="run"]').boundingBox();
    if (!runBox) throw new Error('run pane has no bounding box');
    const runCenter = { x: runBox.x + runBox.width / 2, y: runBox.y + runBox.height / 2 };

    await beginDrag(page, { x: tabBox.x + tabBox.width / 2, y: tabBox.y + tabBox.height / 2 });
    await moveDragTo(page, runCenter);
    await expect(page.getByTestId('drop-zone-center')).toBeVisible({ timeout: 3_000 });
    await page.mouse.up();

    await expect(page.locator('[data-testid="files-tab-strip"]').getByRole('tab')).toHaveCount(0);
    await expect(page.getByTestId('files-surface-picker')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="run-surface"]').getByRole('tab')).toHaveCount(1, { timeout: 5_000 });
  });

  test('Escape cancels a Files-tab drag; the tab stays in Files', async () => {
    const { page } = app;
    await openFileTab(page, 'CLAUDE.md');
    const filesTab = page.locator('[data-testid="files-tab-strip"]').getByRole('tab').first();
    const tabBox = await filesTab.boundingBox();
    if (!tabBox) throw new Error('files tab has no bounding box');
    const tabCenter = { x: tabBox.x + tabBox.width / 2, y: tabBox.y + tabBox.height / 2 };

    await beginDrag(page, tabCenter);
    await moveDragTo(page, { x: tabCenter.x, y: tabCenter.y + 60 });
    await expect(page.getByTestId('surface-drag-layer')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('surface-drag-layer')).toHaveCount(0);
    // Release back over the tab's own origin (a harmless re-click of an already-active,
    // single tab) rather than wherever the drag last pointed, so the mouseup can't land
    // on an unrelated control.
    await page.mouse.move(tabCenter.x, tabCenter.y);
    await page.mouse.up();

    await expect(page.locator('[data-testid="files-tab-strip"]').getByRole('tab')).toHaveCount(1);
    await expect(page.locator('[data-testid="run-surface"]').getByRole('tab')).toHaveCount(1);
  });

  test('dragging a Files tab onto the right edge of Run splits it into a second pane', async () => {
    const { page } = app;
    const filesTab = page.locator('[data-testid="files-tab-strip"]').getByRole('tab').first();
    const tabBox = await filesTab.boundingBox();
    if (!tabBox) throw new Error('files tab has no bounding box');
    const runBox = await page.locator('[data-drop-surface="run"]').boundingBox();
    if (!runBox) throw new Error('run pane has no bounding box');
    // Well inside the outer 25% edge band (computeDropEdge in use-surface-drag.ts) and
    // vertically centered, so it resolves unambiguously to the right edge.
    const edgeTarget = { x: runBox.x + runBox.width * 0.95, y: runBox.y + runBox.height / 2 };

    await beginDrag(page, { x: tabBox.x + tabBox.width / 2, y: tabBox.y + tabBox.height / 2 });
    await moveDragTo(page, edgeTarget);
    await expect(page.getByTestId('drop-zone-right')).toBeVisible({ timeout: 3_000 });
    await page.mouse.up();

    // `[data-testid^="run-pane-"]` also matches the secondary pane's own
    // `run-pane-close-<paneId>` un-split button (RunTabStrip.tsx) — the pane
    // id itself is `pane-<hex>` (genId('pane') in store/run-pane.ts), so only
    // the root divs (`run-pane-pane-<hex>`) share the tighter prefix below.
    // Verified live: a correct 2-pane split produced 3 matches on the looser
    // selector (2 roots + 1 close button) before this fix.
    await expect(page.locator('[data-testid^="run-pane-pane-"]')).toHaveCount(2, { timeout: 5_000 });
    await expect(page.getByTestId('files-surface-picker')).toBeVisible({ timeout: 5_000 });
  });

  // TODO(app-tauri): whole-surface grip drag (repositionSurface → top-left / top-right /
  // bottom, via files-surface-drag / run-surface-drag) is NOT covered here. It commits
  // through the exact same drag-store + SurfaceDragLayer elementFromPoint hit-testing
  // path already exercised by the Files-tab-to-Run drags above, but landing a grip drag
  // precisely on a *different* surface's drop region — and asserting the resulting
  // top/bottom layout reshuffle — needs coordinates relative to whichever panel occupies
  // each reposition target, which shifts as panes are added/removed earlier in this
  // describe. Kept to the structurally-identical, more deterministic tab-drag case
  // instead of guessing those coordinates blind (no live run available to confirm).
  test('surface grip drag reposition (top-left / top-right / bottom) — not covered (live-run needed)', async () => {
    test.skip(
      true,
      'TODO(app-tauri): needs a live run to pin reposition-target coordinates deterministically; ' +
        'see the comment above this test for why the tab-drag case was prioritized instead.',
    );
  });
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
    test.skip(
      true,
      'TODO(app-tauri): useLayoutStore.setActiveSession is never called from application runtime ' +
        'code — grepped packages/ui/src for `.setActiveSession(`; the only call sites are ' +
        'store/__tests__/layout*.test.ts. The per-session `sessions` Map + zustand persist wiring in ' +
        'store/layout.ts / store/layout-persist.ts exist at the store layer but nothing keys the live ' +
        'layout/run state by chat id on session switch, so this scenario cannot pass yet: switching ' +
        'chats currently leaves the SAME global layout visible in every session. Unskip once a wiring ' +
        'hook (e.g. in useSessionListRouter, on mainThreadId/remoteId change) calls ' +
        'useLayoutStore.getState().setActiveSession(remoteId).',
    );

    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Arrange: open chat A, toggle Files on.
    await sidebar.row(chatA).click();
    await composer(page).input().waitFor({ timeout: 10_000 });
    await page.getByTestId('surface-rail-files').click();
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });

    // Switch to session B — should show the DEFAULT layout (Chat only).
    await sidebar.row(chatB).click();
    await composer(page).input().waitFor({ timeout: 10_000 });
    await expect(page.getByTestId('files-surface')).toHaveCount(0);

    // Switch back to A — the arranged layout should be restored.
    await sidebar.row(chatA).click();
    await composer(page).input().waitFor({ timeout: 10_000 });
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });
  });
});
