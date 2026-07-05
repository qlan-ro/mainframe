/**
 * §directory-picker — DirectoryPickerModal (plan spec #25) for app-tauri browser mode.
 *
 * Entry point: the sidebar's dashed "Add project" pill (`sessions-add-project`,
 * ProjectFilterPillBar.tsx) opens the picker via `pickDirectory({ mode: 'directory' })`
 * (features/files/use-directory-picker.ts). This is the ONLY reachable UI entry point
 * today — grepped every `pickDirectory`/`useDirectoryPicker` call site;
 * `features/sessions/use-add-project.ts` is the sole caller and is hardcoded to
 * `mode: 'directory'`. There is no file-mode consumer, so the file-mode scenario is
 * `test.skip`'d below.
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
 * Testid reference (verified against packages/ui/src/components/overlays/):
 *   directory-picker                     — dialog root (DirectoryPickerModal.tsx)
 *   directory-picker-close               — header X close button
 *   directory-picker-path-input          — PathCrumbInput editable crumb
 *   directory-picker-row-<path>          — a tree row (PickerTree.tsx)
 *   directory-picker-node-empty-<path>   — per-node "Empty" state (expanded, 0 children)
 *   directory-picker-load-error-<path>   — per-node "Failed to load" state
 *   directory-picker-empty               — root-level empty state
 *   directory-picker-loading             — root-level "Loading…" state
 *   directory-picker-error               — root-level load error
 *   directory-picker-selected-path       — footer path readout
 *   directory-picker-cancel              — footer Cancel button
 *   directory-picker-confirm             — footer Select (confirm) button
 *   directory-picker-recent              — RecentDirs section root (home root only)
 *   directory-picker-recent-<path>       — a Recent row (RecentDirs.tsx)
 *   sessions-add-project                 — sidebar dashed "Add project" pill (entry point)
 *   toast-root                           — WsToastCard root (add-project outcome toast)
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/** Number of projects currently registered with the daemon. */
async function projectCount(page: Page): Promise<number> {
  const res = await page.request.get(`${DAEMON_BASE}/api/projects`);
  const body = (await res.json()) as { data?: unknown[] };
  return body.data?.length ?? 0;
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
  });

  test.afterAll(async () => {
    cleanupTauriProject(projectEmpty);
    cleanupTauriProject(projectTree);
    await closeTauriApp(app);
  });

  test('opens seeded at the home root with the directory-mode title', async () => {
    const { page } = app;
    await page.getByTestId('sessions-add-project').click();

    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });
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
    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });

    const input = page.getByTestId('directory-picker-path-input');
    await input.fill(projectTree.projectPath);
    await input.press('Enter');
    await page.getByTestId(`directory-picker-row-${srcPath}`).click();
    await expect(page.getByTestId('directory-picker-confirm')).toBeEnabled();

    await page.getByTestId('directory-picker-confirm').click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('toast-root').filter({ hasText: 'Project added' })).toBeVisible({
      timeout: 10_000,
    });

    // Recents only render at the home root — reopen and land back at '~'.
    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker-recent')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`directory-picker-recent-${srcPath}`)).toBeVisible();
  });

  test('clicking a Recent row re-picks it in one click', async () => {
    const { page } = app;
    await page.getByTestId(`directory-picker-recent-${srcPath}`).click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    // `src` was already registered by the previous test — the daemon reports a duplicate.
    await expect(page.getByTestId('toast-root').filter({ hasText: 'Project already added' })).toBeVisible({
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
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('an unreachable path shows an inline load error, not stale rows', async () => {
    const { page } = app;
    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });

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
    await page.getByTestId('sessions-add-project').click();
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
    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
  });

  test('the header Close button dismisses without registering a project', async () => {
    const { page } = app;
    const before = await projectCount(page);

    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('directory-picker-close').click();

    await expect(page.getByTestId('directory-picker')).toHaveCount(0, { timeout: 5_000 });
    expect(await projectCount(page)).toBe(before);
  });

  test('shows a loading indicator while a browse request is in flight', async () => {
    const { page } = app;
    await page.getByTestId('sessions-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });
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
