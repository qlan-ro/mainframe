/**
 * §files-tree — workspace Files sidebar (Files tree) + FilePickerDialog specs.
 *
 * UI-only, no AI turns — no recording needed. All tests run against a REST-seeded
 * git repo the test process itself mutates with plain `git` calls (array-arg
 * execFileSync, no shell interpolation).
 *
 * The tree lives INSIDE the workspace surface since the session-tabs rework
 * (docs/plans/2026-08-08-session-tabs-and-workspace-files.md), as a persistent
 * DOCKED sidebar on the surface's right edge (reversed from the earlier
 * floating/light-dismissed glass panel, 2026-08-15 — see packages/ui/CLAUDE.md).
 * It resizes/pushes the content pane rather than overlaying it, closes only
 * via its own toggle (never Escape or an outside click — a docked sidebar has
 * no "outside" to light-dismiss into), and stays MOUNTED while collapsed, so
 * tree expansion survives a close. The app-level InspectorPane is deleted.
 * Change-scope coverage lives in review-panel.spec.ts's "§review-panel —
 * change scopes", not here.
 *
 * Testid reference (verified against packages/ui/src):
 *   surface-rail-workspace   — toolbar surface toggle (lights the workspace;
 *                              the strip's Files button only exists while lit —
 *                              the old toolbar Files toggle is deleted, and the
 *                              palette's "Toggle Files" covers the hidden case)
 *   workspace-files-panel    — the docked sidebar's content (present only while OPEN)
 *   workspace-files-open     — the strip's Files button (primary pane +
 *                              empty-state header)
 *   workspace-files-collapse — close control on the tree's header row
 *   file-tree                — FileTree root
 *   file-tree-row-<path>     — a file or folder row (folders toggle expand/collapse)
 *   file-tree-refresh        — refetch the tree
 *   file-tree-find-in-file / file-tree-find-in-folder — context-menu item (file vs folder)
 *   file-tree-reveal         — context-menu "Reveal in Finder" (local-daemon gated)
 *   file-tree-copy-path / file-tree-copy-relative-path — context-menu copy actions
 *   viewer-shell-reveal      — a viewer tab's "Reveal in file tree" button
 *   surface-rail-workspace     — MainToolbar toggle for the workspace surface
 *   workspace-picker-open-file — the empty-state card's "Open file…" row
 *   workspace-pane-open-file-<paneId> — the same action inside a pane's `+` menu
 *   file-picker-dialog       — FilePickerDialog root
 *   file-picker-input        — search input
 *   file-picker-row-<path>   — a search result row
 *   file-picker-no-project   — no-project empty state
 *   WORKSPACE.strip            — a workspace pane's tab strip (role="tab" pills)
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { WORKSPACE } from '../helpers/tauri/testids.js';
import { showFilesTree, workspace } from '../helpers/tauri/page-objects.js';
import { closeMenus } from '../helpers/tauri/menus.js';

// ── git helpers (test-process only; array-arg execFileSync, no shell) ─────────

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitCommit(cwd: string, message: string): void {
  git(cwd, ['-c', 'user.email=e2e@mainframe.test', '-c', 'user.name=Mainframe E2E', 'commit', '-m', message]);
}

/**
 * Toggle the workspace surface on (MainToolbar surface rail).
 *
 * Wait on the SURFACE, not on a pane strip: with no tabs open the workspace renders
 * `workspace-empty-state`, whose header is the same chrome row minus a pane
 * (WorkspaceStripChrome), so `workspace-tab-strip-pane-<id>` does not exist yet.
 */
async function ensureWorkspaceOn(page: import('@playwright/test').Page): Promise<void> {
  const surface = page.getByTestId('workspace-surface');
  if (await surface.isVisible().catch(() => false)) return;
  await page.getByTestId('surface-rail-workspace').click();
  await expect(surface).toBeVisible({ timeout: 10_000 });
}

// ─── §files-tree — no project ──────────────────────────────────────────────────

test.describe('§files-tree — no project', () => {
  let app: TauriAppFixture;

  test.beforeAll(async () => {
    app = await launchTauriApp();
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
  });

  test('files panel shows the no-project empty state before any chat is active', async () => {
    const { page } = app;
    await page.getByTestId('surface-rail-workspace').click();
    await page.getByTestId('workspace-files-open').click();
    const pane = page.getByTestId('workspace-files-panel');
    await expect(pane).toBeVisible({ timeout: 10_000 });
    await expect(pane.getByText('Open a session to browse its files.')).toBeVisible();
  });

  test('file picker shows the no-project state when opened with no active chat', async () => {
    const { page } = app;
    await ensureWorkspaceOn(page);
    await workspace(page).openFilePicker();
    // No `projectId` → FilePickerDialog renders the no-project empty state
    // directly (no `file-picker-dialog` wrapper — that testid only exists on
    // `PickerBody`, which is skipped when there's no active project).
    await expect(page.getByTestId('file-picker-no-project')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('file-picker-no-project')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ─── §files-tree — workspace Files sidebar ──────────────────────────────────────

test.describe('§files-tree — workspace Files sidebar', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    const dir = project.projectPath;

    // Baseline tree fixture: a nested folder (for lazy-expand) + a viewer file
    // (for the reveal-from-viewer test).
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'utils.ts'), 'export const util = 1;\n');
    writeFileSync(path.join(dir, 'data.csv'), 'name,age\nAlice,30\nBob,25\n');
    writeFileSync(path.join(dir, 'notes.md'), '# notes\n');
    // createTauriProject already wrote CLAUDE.md + index.ts (untracked). Commit
    // everything as a clean baseline so the tree/reveal/context-menu tests run
    // against a repo with no uncommitted noise.
    git(dir, ['add', '-A']);
    gitCommit(dir, 'seed baseline');

    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // ── Panel chrome ──────────────────────────────────────────────────────────

  test('the strip Files button opens the docked sidebar and toggles it closed; Escape and outside clicks do NOT dismiss it', async () => {
    const { page } = app;
    const stripButton = page.getByTestId('workspace-files-open');
    const pane = page.getByTestId('workspace-files-panel');

    // Boot: workspace unlit → no strip, no panel. Light the surface first —
    // the strip's Files button is the sidebar's one docked trigger now (the
    // toolbar toggle is gone; the palette's "Toggle Files" covers the
    // workspace-hidden case via the toggle-workspace-files intent).
    await expect(pane).toHaveCount(0);
    await page.getByTestId('surface-rail-workspace').click();
    await expect(stripButton).toBeVisible({ timeout: 10_000 });
    await expect(stripButton).toHaveAttribute('aria-pressed', 'false');

    await stripButton.click();
    await expect(pane).toBeVisible();
    await expect(stripButton).toHaveAttribute('aria-pressed', 'true');

    // A docked sidebar has no "outside" to light-dismiss into — Escape leaves it open.
    await page.keyboard.press('Escape');
    await expect(pane).toBeVisible();

    // Second click on the trigger closes it (no dismiss-then-reopen double toggle).
    await stripButton.click();
    await expect(pane).toHaveCount(0);
    await expect(stripButton).toHaveAttribute('aria-pressed', 'false');

    // Reopen; leave it open for the tests below.
    await stripButton.click();
    await expect(pane).toBeVisible();
  });

  test('the panel body is the file tree, with no header row above it', async () => {
    const { page } = app;
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 10_000 });
    // The tree's own project-name row is the header — close sits next to refresh.
    await expect(page.getByTestId('workspace-files-collapse')).toBeVisible();
    await expect(page.getByTestId('inspector-tab-files')).toHaveCount(0);
    await expect(page.getByTestId('inspector-tab-changes')).toHaveCount(0);
    await expect(page.getByTestId('changes-panel')).toHaveCount(0);
  });

  // ── File tree ──────────────────────────────────────────────────────────────

  test('the file tree loads the seeded project root', async () => {
    const { page } = app;
    await expect(page.getByTestId('file-tree-row-CLAUDE.md')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('file-tree-row-index.ts')).toBeVisible();
    await expect(page.getByTestId('file-tree-row-data.csv')).toBeVisible();
    await expect(page.getByTestId('file-tree-row-src')).toBeVisible();
    // Not yet expanded — the nested file is not in the DOM.
    await expect(page.getByTestId('file-tree-row-src/utils.ts')).toHaveCount(0);
  });

  test('expanding a folder lazily fetches and renders its children', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click();
    await expect(page.getByTestId('file-tree-row-src/utils.ts')).toBeVisible({ timeout: 10_000 });
  });

  test('collapsing an expanded folder hides its children', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click();
    await expect(page.getByTestId('file-tree-row-src/utils.ts')).toHaveCount(0);
  });

  // "Files editor tab" in the old name — the Files surface is gone since the
  // 2026-08-05 merge; the tab lands in the one `workspace` surface.
  test('clicking a file opens it in a workspace editor tab', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-CLAUDE.md').click();
    const strip = page.locator(WORKSPACE.strip);
    await expect(strip.getByRole('tab')).toHaveCount(1, { timeout: 10_000 });
    await expect(strip.getByRole('tab', { selected: true })).toContainText('CLAUDE.md');
  });

  test('the refresh button re-fetches the tree and shows a newly created file', async () => {
    const { page } = app;
    // The docked sidebar stays open across a file open — showFilesTree is a
    // no-op here, kept for robustness if an earlier test in the file changes.
    await showFilesTree(page);
    await expect(page.getByTestId('file-tree-row-runtime-file.txt')).toHaveCount(0);
    writeFileSync(path.join(project.projectPath, 'runtime-file.txt'), 'created after mount\n');
    await page.getByTestId('file-tree-refresh').click();
    await expect(page.getByTestId('file-tree-row-runtime-file.txt')).toBeVisible({ timeout: 10_000 });
  });

  test('revealing a file from its viewer highlights it in the tree', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-data.csv').click();
    await expect(page.getByTestId('viewer-csv')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('viewer-shell-reveal').click();
    // The tree is the Inspector's only body now — no tab to switch back to.
    const row = page.getByTestId('file-tree-row-data.csv');
    await expect(row).toHaveAttribute('data-highlighted', 'true', { timeout: 10_000 });
  });

  // ── Context menus ─────────────────────────────────────────────────────────

  test('the file row context menu offers find-in-file, reveal, and copy actions', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-index.ts').click({ button: 'right' });
    await expect(page.getByTestId('file-tree-find-in-file')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('file-tree-find-in-folder')).toHaveCount(0);
    await expect(page.getByTestId('file-tree-reveal')).toBeVisible();
    await expect(page.getByTestId('file-tree-copy-path')).toBeVisible();
    await expect(page.getByTestId('file-tree-copy-relative-path')).toBeVisible();
    await closeMenus(page);
  });

  test('the folder row context menu offers find-in-folder instead of find-in-file', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click({ button: 'right' });
    await expect(page.getByTestId('file-tree-find-in-folder')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('file-tree-find-in-file')).toHaveCount(0);
    await closeMenus(page);
  });

  test('the root row context menu is available from the header label', async () => {
    const { page } = app;
    const rootLabel = page.getByTestId('file-tree').getByText(path.basename(project.projectPath), { exact: true });
    await rootLabel.click({ button: 'right' });
    await expect(page.getByTestId('file-tree-find-in-folder')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('file-tree-reveal')).toBeVisible();
    await closeMenus(page);
  });

  test('reveal in Finder is enabled against the local test daemon', async () => {
    const { page } = app;
    // The e2e daemon target is `kind: 'local'` (useDaemonIsLocal() === true), so
    // Reveal in Finder is enabled here — assert presence + enabled state only,
    // never click (it shells out to the OS file manager; Tauri-native, not
    // exercisable in browser mode).
    await page.getByTestId('file-tree-row-index.ts').click({ button: 'right' });
    const reveal = page.getByTestId('file-tree-reveal');
    await expect(reveal).toBeVisible({ timeout: 5_000 });
    await expect(reveal).not.toHaveAttribute('data-disabled');
    await closeMenus(page);
  });

  // ── FilePickerDialog ──────────────────────────────────────────────────────

  test('the file picker opens from the tab-strip add button with the search hint', async () => {
    const { page } = app;
    await ensureWorkspaceOn(page);
    await workspace(page).openFilePicker();
    const dialog = page.getByTestId('file-picker-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Type to search files')).toBeVisible();
  });

  test('the file picker searches by name, supports arrow-key navigation, and opens the selected file with Enter', async () => {
    const { page } = app;
    const input = page.getByTestId('file-picker-input');
    await input.fill('CLAUDE');
    const row = page.getByTestId('file-picker-row-CLAUDE.md');
    await expect(row).toBeVisible({ timeout: 5_000 });

    await input.press('ArrowDown');
    await input.press('Enter');

    await expect(page.getByTestId('file-picker-dialog')).toHaveCount(0, { timeout: 5_000 });
    const strip = page.locator(WORKSPACE.strip);
    await expect(strip.getByRole('tab', { selected: true })).toContainText('CLAUDE.md');
  });

  test('the file picker shows a no-match empty state for an unmatched query', async () => {
    const { page } = app;
    await workspace(page).openFilePicker();
    const input = page.getByTestId('file-picker-input');
    await input.fill('zzz-does-not-exist');
    await expect(page.getByText('No matching files')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('file-picker-input')).toHaveCount(0, { timeout: 5_000 });
  });
});
