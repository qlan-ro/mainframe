/**
 * §directory-picker — DirectoryPickerModal (plan spec #25) for app-tauri browser mode.
 *
 * Entry point: the Projects section's "+" action in the sidebar header
 * (`sidebar-projects-add`, v2/features/sessions/ProjectSection.tsx) opens the picker
 * via `pickDirectory({ mode: 'directory' })` (features/files/use-directory-picker.ts).
 * The v1 dashed "Add project" pill and its `sessions-add-project` id died with
 * ProjectFilterPillBar — the v2 projects switcher is a plain list with a
 * `SidebarGroupAction` instead. This is still the ONLY reachable UI entry point:
 * `features/sessions/use-add-project.ts` is the sole `pickDirectory` caller and is
 * hardcoded to `mode: 'directory'`, so the file-mode scenario is `test.skip`'d below.
 *
 * KNOWN SIDE EFFECT: confirming a directory in the add-project flow calls
 * `createProject` on the daemon (features/sessions/use-add-project.ts) — the daemon
 * does not validate that the path is a git repo, it just stores it
 * (packages/core/src/server/routes/projects.ts POST /api/projects). Tests that only
 * need to exercise navigation/selection use Cancel/Close/Escape instead of Confirm;
 * the one test that does Confirm asserts the resulting toast instead of avoiding it.
 * Each describe below runs its own daemon (fresh SQLite per `launchTauriApp`), so
 * registered projects never leak across describes.
 *
 * Testid reference (verified against packages/ui/src/v2/features/files/ — the picker
 * is v2-native now; the v1 components/overlays/ tree it used to live in is gone,
 * and only the non-visual `use-picker-tree`/`picker-tree-model` are still imported
 * from there):
 *   directory-picker                     — dialog root (DirectoryPickerModal.tsx)
 *   dialog-close                         — the STOCK v2 DialogContent close button. The
 *                                          picker's own `directory-picker-close` header X is
 *                                          gone: it dropped `showCloseButton={false}`, so
 *                                          the primitive's built-in close (one shared
 *                                          `dialog-close` testid for whatever dialog is
 *                                          open) is the only X. Scope it to the picker root.
 *   directory-picker-path-input          — PathCrumbInput editable crumb
 *   directory-picker-row-<path>          — a tree row (PickerTree.tsx FlatTreeView)
 *   directory-picker-node-empty-<path>   — per-node "Empty" state (expanded, 0 children)
 *   directory-picker-node-loading-<path> — per-node "Loading…" state (expanding)
 *   directory-picker-load-error-<path>   — per-node "Failed to load" state
 *   directory-picker-empty               — root-level empty state
 *   directory-picker-loading             — root-level "Loading…" state
 *   directory-picker-error               — root-level load error
 *   directory-picker-selected-path       — footer path readout
 *   directory-picker-cancel              — footer Cancel button
 *   directory-picker-confirm             — footer Select (confirm) button
 *   directory-picker-recent              — RecentDirs section root (home root only)
 *   directory-picker-recent-<path>       — a Recent row (RecentDirs.tsx)
 *   sidebar-projects-add                 — the Projects section's "+" action (entry point)
 *   TOAST.root (helpers/tauri/testids.ts) — native sonner toast; WsToastCard is gone
 *
 * TWO STRAY LAYERS make clicks inside this dialog time out on elements Playwright
 * itself calls "visible, enabled and stable". Both are handled in setup, not with
 * retries:
 *
 *  1. THE ZERO-SESSION BOOT PICKER — hence each describe seeds a session it never
 *     looks at. A registered project with ZERO sessions is the app's boot dead-end,
 *     and `ChatSurface`'s `useZeroSessionBootPicker` force-opens the
 *     `sessions-new-picker` DropdownMenu 1.5s after the app settles there. It is a
 *     modal layer that takes over the page's pointer events, and it re-arms whenever
 *     that condition is re-entered (e.g. after this suite registers another project),
 *     so dismissing it once is not enough — one real session removes the condition.
 *  2. THE DYING DIALOG SCRIM — hence `openPicker` below. See its doc comment: the
 *     overlay outlives the content's unmount, so the next picker opens underneath
 *     the previous one's fading scrim and every click in it is intercepted.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { waitForDialogScrimsGone } from '../helpers/tauri/menus.js';
import { TOAST } from '../helpers/tauri/testids.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/** Number of projects currently registered with the daemon. */
async function projectCount(page: Page): Promise<number> {
  const res = await page.request.get(`${DAEMON_BASE}/api/projects`);
  const body = (await res.json()) as { data?: unknown[] };
  return body.data?.length ?? 0;
}

/**
 * Open the picker from the Projects section's "+", never on top of a dying scrim.
 *
 * A dialog's content and its overlay are separate elements with separate exit
 * animations, so `directory-picker` reaching count 0 proves only that the CONTENT
 * unmounted — the `bg-black/10` scrim can still be fading. Open the next picker in
 * that window and every click inside it is intercepted by the previous dialog's
 * overlay (measured live on `directory-picker-confirm`, retried for the full 60s
 * budget on a button Playwright itself calls "visible, enabled and stable"). Since
 * this describe opens and dismisses the picker in nearly every test, the wait
 * belongs on the OPEN side, once.
 */
async function openPicker(page: Page): Promise<void> {
  await waitForDialogScrimsGone(page);
  await page.getByTestId('sidebar-projects-add').click();
  await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });
}

// ─── §directory-picker Open, browse, select, confirm ─────────────────────────

test.describe('§directory-picker Open, browse, select, confirm', () => {
  let app: TauriAppFixture;
  // No subfolders — used to exercise the root-level Empty state.
  let projectEmpty: TauriProject;
  // Gets a nested src/lib subfolder — used to exercise expand/select/confirm/recents.
  let projectTree: TauriProject;
  let srcPath: string;
  let libPath: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    projectEmpty = await createTauriProject(app.page);
    projectTree = await createTauriProject(app.page);
    srcPath = path.join(projectTree.projectPath, 'src');
    libPath = path.join(srcPath, 'lib');
    mkdirSync(libPath, { recursive: true });
    // Keeps the app off its zero-session boot dead-end for the whole describe —
    // see the header note. Nothing below reads this chat.
    await createTauriChat(app.page, projectTree.projectId);
  });

  test.afterAll(async () => {
    cleanupTauriProject(projectEmpty);
    cleanupTauriProject(projectTree);
    await closeTauriApp(app);
  });

  test('opens seeded at the home root with the directory-mode title', async () => {
    const { page } = app;
    await openPicker(page);

    await expect(page.getByText('Select Project Directory')).toBeVisible();
    await expect(page.getByTestId('directory-picker-path-input')).toHaveValue('~');
  });

  test("pasting the temp project's absolute path re-seeds the tree there", async () => {
    const { page } = app;
    const input = page.getByTestId('directory-picker-path-input');
    await input.fill(projectTree.projectPath);
    await input.press('Enter');

    await expect(input).toHaveValue(projectTree.projectPath);
    await expect(page.getByTestId(`directory-picker-row-${srcPath}`)).toBeVisible({ timeout: 10_000 });
  });

  test('clicking a directory row expands it, lazy-loads its child, and selects it', async () => {
    const { page } = app;
    await page.getByTestId(`directory-picker-row-${srcPath}`).click();

    await expect(page.getByTestId(`directory-picker-row-${libPath}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('directory-picker-confirm')).toBeEnabled();
    await expect(page.getByTestId('directory-picker-selected-path')).toHaveText(srcPath);
  });

  test('expanding the empty nested directory shows the per-node Empty state', async () => {
    const { page } = app;
    await page.getByTestId(`directory-picker-row-${libPath}`).click();

    const nodeEmpty = page.getByTestId(`directory-picker-node-empty-${libPath}`);
    await expect(nodeEmpty).toBeVisible({ timeout: 10_000 });
    await expect(nodeEmpty).toHaveText('Empty');
  });

  test('navigating to a directory with no subfolders shows the root Empty state', async () => {
    const { page } = app;
    const input = page.getByTestId('directory-picker-path-input');
    await input.fill(projectEmpty.projectPath);
    await input.press('Enter');

    const rootEmpty = page.getByTestId('directory-picker-empty');
    await expect(rootEmpty).toBeVisible({ timeout: 10_000 });
    await expect(rootEmpty).toHaveText('This folder is empty.');
  });

  test('Cancel closes the dialog without registering a project', async () => {
    const { page } = app;
    const before = await projectCount(page);

    await page.getByTestId('directory-picker-cancel').click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    expect(await projectCount(page)).toBe(before);
  });

  test('confirming a directory registers it as a project and adds it to Recents', async () => {
    const { page } = app;
    await openPicker(page);

    const input = page.getByTestId('directory-picker-path-input');
    await input.fill(projectTree.projectPath);
    await input.press('Enter');
    await page.getByTestId(`directory-picker-row-${srcPath}`).click();
    await expect(page.getByTestId('directory-picker-confirm')).toBeEnabled();

    await page.getByTestId('directory-picker-confirm').click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator(TOAST.root).filter({ hasText: 'Project added' })).toBeVisible({
      timeout: 10_000,
    });

    // Recents only render at the home root — reopen and land back at '~'.
    await openPicker(page);
    await expect(page.getByTestId('directory-picker-recent')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`directory-picker-recent-${srcPath}`)).toBeVisible();
  });

  test('clicking a Recent row re-picks it in one click', async () => {
    const { page } = app;
    await page.getByTestId(`directory-picker-recent-${srcPath}`).click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    // `src` was already registered by the previous test — the daemon reports a duplicate.
    await expect(page.locator(TOAST.root).filter({ hasText: 'Project already added' })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── §directory-picker Path-crumb edge cases + dismiss ────────────────────────

test.describe('§directory-picker Path-crumb edge cases + dismiss', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // Zero-session boot dead-end again — see the header note.
    await createTauriChat(app.page, project.projectId);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('an unreachable path shows an inline load error, not stale rows', async () => {
    const { page } = app;
    await openPicker(page);

    const input = page.getByTestId('directory-picker-path-input');
    await input.fill('/definitely/not/a/real/path/xyz-e2e');
    await input.press('Enter');

    const error = page.getByTestId('directory-picker-error');
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(error).toContainText("Couldn't open");

    await page.getByTestId('directory-picker-cancel').click();
    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });

  // Previously: Escape always closed the whole dialog, even with an edited
  // (unsaved) crumb draft — Radix Dialog's capture-phase Escape-close listener
  // ran before `PathCrumbInput`'s own bubble-phase handler could
  // preventDefault/stopPropagation. Fixed by the product-bug-fix campaign;
  // Escape now reverts the draft in place and leaves the dialog open.
  test('Escape reverts an edited crumb draft without closing the dialog', async () => {
    const { page } = app;
    await openPicker(page);
    const input = page.getByTestId('directory-picker-path-input');
    await expect(input).toHaveValue('~', { timeout: 10_000 });

    await input.fill('/some/edited/draft');
    await expect(input).toHaveValue('/some/edited/draft');

    await page.keyboard.press('Escape');

    await expect(input).toHaveValue('~');
    await expect(page.getByTestId('directory-picker')).toBeVisible();

    await page.getByTestId('directory-picker-cancel').click();
    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });

  test('Escape with an unedited crumb closes the dialog', async () => {
    const { page } = app;
    await openPicker(page);

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });

  // The picker's own header X (`directory-picker-close`) is gone — DirectoryPickerModal
  // no longer passes `showCloseButton={false}`, so the close affordance is the v2
  // DialogContent's built-in one. Its testid (`dialog-close`) is shared by every
  // dialog in the app, hence the scoping to the picker root.
  test('the built-in Close button dismisses without registering a project', async () => {
    const { page } = app;
    const before = await projectCount(page);

    await openPicker(page);
    const picker = page.getByTestId('directory-picker');
    await picker.getByTestId('dialog-close').click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    expect(await projectCount(page)).toBe(before);
  });

  test('shows a loading indicator while a browse request is in flight', async () => {
    const { page } = app;
    await openPicker(page);
    // Let the initial home-root browse settle before delaying the next one.
    await expect(page.getByTestId('directory-picker-loading')).toHaveCount(0, { timeout: 15_000 });

    await page.route('**/api/filesystem/browse*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    const input = page.getByTestId('directory-picker-path-input');
    await input.fill(project.projectPath);
    await input.press('Enter');

    await expect(page.getByTestId('directory-picker-loading')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('directory-picker-loading')).toHaveCount(0, { timeout: 10_000 });

    await page.unroute('**/api/filesystem/browse*');
    await page.getByTestId('directory-picker-cancel').click();
    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ─── §directory-picker File mode ───────────────────────────────────────────────

test.describe('§directory-picker File mode', () => {
  test('file-mode is not reachable from any UI entry point', () => {
    test.skip(
      true,
      'TODO(app-tauri): no UI consumer calls pickDirectory({ mode: "file" }) today — ' +
        'features/sessions/use-add-project.ts is the only pickDirectory call site and it is ' +
        'hardcoded to mode: "directory" (grepped every pickDirectory/useDirectoryPicker call site). ' +
        'Unskip once a file-pick consumer (e.g. an attach-file flow) wires useDirectoryPicker with ' +
        'mode: "file".',
    );
  });
});
