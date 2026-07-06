/**
 * §files-tree — Inspector pane (Files tree / Changes panel) + FilePickerDialog specs.
 *
 * UI-only, no AI turns — no recording needed. All tests run against a REST-seeded
 * git repo the test process itself mutates with plain `git` calls (array-arg
 * execFileSync, no shell interpolation).
 *
 * Testid reference (verified against packages/ui/src):
 *   main-toolbar-inspector   — toolbar button, toggles the Inspector pane
 *   inspector-pane           — Inspector root (mounted only when visible)
 *   inspector-tab-files      — Files tab in the Inspector's Files/Changes switch
 *   inspector-tab-changes    — Changes tab (shows a live uncommitted-count badge)
 *   file-tree                — FileTree root
 *   file-tree-row-<path>     — a file or folder row (folders toggle expand/collapse)
 *   file-tree-refresh        — refetch the tree
 *   file-tree-find-in-file / file-tree-find-in-folder — context-menu item (file vs folder)
 *   file-tree-reveal         — context-menu "Reveal in Finder" (local-daemon gated)
 *   file-tree-copy-path / file-tree-copy-relative-path — context-menu copy actions
 *   changes-panel            — ChangesPanel root
 *   changes-mode-<session|uncommitted|branch> — scope switcher buttons
 *   changes-refresh          — refetch the changes list
 *   changes-row-<path>       — a changed-file row (click opens a HEAD-vs-working diff)
 *   changes-status-<path>    — the row's status word (Added/Modified/Deleted/Renamed)
 *   diff-tab                 — the opened diff tab body
 *   viewer-shell-reveal      — a viewer tab's "Reveal in file tree" button
 *   surface-rail-files       — MainToolbar surface toggle for the Files surface
 *   files-tab-strip-add      — Files tab-strip "+" (opens the file picker)
 *   file-picker-dialog       — FilePickerDialog root
 *   file-picker-input        — search input
 *   file-picker-row-<path>   — a search result row
 *   file-picker-no-project   — no-project empty state
 *   files-tab-strip          — Files surface tab strip (role="tab" pills)
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

// ── git helpers (test-process only; array-arg execFileSync, no shell) ─────────

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitCommit(cwd: string, message: string): void {
  git(cwd, ['-c', 'user.email=e2e@mainframe.test', '-c', 'user.name=Mainframe E2E', 'commit', '-m', message]);
}

/** Toggle the Files surface on (MainToolbar surface rail) so FilesTabStrip mounts. */
async function ensureFilesSurfaceOn(page: import('@playwright/test').Page): Promise<void> {
  const strip = page.getByTestId('files-tab-strip');
  if (await strip.isVisible().catch(() => false)) return;
  await page.getByTestId('surface-rail-files').click();
  await expect(strip).toBeVisible({ timeout: 10_000 });
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

  test('inspector shows the no-project empty state before any chat is active', async () => {
    const { page } = app;
    await page.getByTestId('main-toolbar-inspector').click();
    const pane = page.getByTestId('inspector-pane');
    await expect(pane).toBeVisible({ timeout: 10_000 });
    await expect(pane.getByText('Open a session to browse its files.')).toBeVisible();
  });

  test('file picker shows the no-project state when opened with no active chat', async () => {
    const { page } = app;
    await ensureFilesSurfaceOn(page);
    await page.getByTestId('files-tab-strip-add').click();
    // No `projectId` → FilePickerDialog renders the no-project empty state
    // directly (no `file-picker-dialog` wrapper — that testid only exists on
    // `PickerBody`, which is skipped when there's no active project).
    await expect(page.getByTestId('file-picker-no-project')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });
});

// ─── §files-tree — Inspector pane ───────────────────────────────────────────────

test.describe('§files-tree — Inspector pane', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    const dir = project.projectPath;

    // Baseline tree fixture: a nested folder (for lazy-expand) + a viewer file
    // (for the reveal-from-viewer test) + files we will later mutate for the
    // Changes panel status-glyph scenarios.
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'utils.ts'), 'export const util = 1;\n');
    writeFileSync(path.join(dir, 'data.csv'), 'name,age\nAlice,30\nBob,25\n');
    writeFileSync(path.join(dir, 'notes.md'), '# notes\n');
    writeFileSync(path.join(dir, 'delete-me.txt'), 'temp\n');
    // createTauriProject already wrote CLAUDE.md + index.ts (untracked). Commit
    // everything as a clean baseline so the tree/reveal/context-menu tests run
    // against a repo with no uncommitted noise.
    git(dir, ['add', '-A']);
    gitCommit(dir, 'seed baseline');

    // Stage one of each git status kind for the Changes panel: added, modified,
    // deleted, renamed. Staged (not just working-tree) so rename detection kicks
    // in — matches how `git status --porcelain` reports a `git mv`.
    writeFileSync(path.join(dir, 'index.ts'), 'export const greeting = "changed";\n');
    rmSync(path.join(dir, 'delete-me.txt'));
    renameSync(path.join(dir, 'notes.md'), path.join(dir, 'renamed-notes.md'));
    writeFileSync(path.join(dir, 'new-file.txt'), 'new\n');
    git(dir, ['add', '-A']);

    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // ── Inspector chrome ──────────────────────────────────────────────────────

  test('toggling the inspector from the toolbar shows and hides the pane', async () => {
    const { page } = app;
    const toggle = page.getByTestId('main-toolbar-inspector');
    const pane = page.getByTestId('inspector-pane');

    await expect(pane).toHaveCount(0);
    await toggle.click();
    await expect(pane).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('the changes tab badge shows the uncommitted file count', async () => {
    const { page } = app;
    // Seeded: added(new-file.txt) + modified(index.ts) + deleted(delete-me.txt) +
    // renamed(notes.md->renamed-notes.md) = 4 uncommitted files.
    await expect(page.getByTestId('inspector-tab-changes')).toContainText('4', { timeout: 10_000 });
  });

  test('Files tab is selected by default and Changes tab switches the body', async () => {
    const { page } = app;
    await expect(page.getByTestId('inspector-tab-files')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('inspector-tab-changes').click();
    await expect(page.getByTestId('inspector-tab-changes')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('changes-panel')).toBeVisible({ timeout: 10_000 });

    // Switch back to Files for the tree tests below.
    await page.getByTestId('inspector-tab-files').click();
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 10_000 });
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

  test('clicking a file opens it in a Files editor tab', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-CLAUDE.md').click();
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab')).toHaveCount(1, { timeout: 10_000 });
    await expect(strip.getByRole('tab', { selected: true })).toContainText('CLAUDE.md');
  });

  test('the refresh button re-fetches the tree and shows a newly created file', async () => {
    const { page } = app;
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
    // The reveal intent activates the Files surface but not the Inspector's own
    // Files/Changes tab — switch to it to observe the highlight.
    await page.getByTestId('inspector-tab-files').click();

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
    await page.keyboard.press('Escape');
  });

  test('the folder row context menu offers find-in-folder instead of find-in-file', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click({ button: 'right' });
    await expect(page.getByTestId('file-tree-find-in-folder')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('file-tree-find-in-file')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('the root row context menu is available from the header label', async () => {
    const { page } = app;
    const rootLabel = page.getByTestId('file-tree').getByText(path.basename(project.projectPath), { exact: true });
    await rootLabel.click({ button: 'right' });
    await expect(page.getByTestId('file-tree-find-in-folder')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('file-tree-reveal')).toBeVisible();
    await page.keyboard.press('Escape');
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
    await page.keyboard.press('Escape');
  });

  // ── Changes panel ─────────────────────────────────────────────────────────

  test('switching scope modes changes the changes-panel row set', async () => {
    const { page } = app;
    await page.getByTestId('inspector-tab-changes').click();
    await expect(page.getByTestId('changes-panel')).toBeVisible({ timeout: 10_000 });

    // Default scope is "Uncommitted" — our staged mutations are visible.
    await expect(page.getByTestId('changes-mode-uncommitted')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('changes-row-index.ts')).toBeVisible({ timeout: 10_000 });

    // Session scope: no agent turns ran in this chat, so no session-touched files.
    await page.getByTestId('changes-mode-session').click();
    await expect(page.getByTestId('changes-mode-session')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('No changes.')).toBeVisible({ timeout: 10_000 });

    // Branch scope: single-branch repo, no divergence from base.
    await page.getByTestId('changes-mode-branch').click();
    await expect(page.getByTestId('changes-mode-branch')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('0 changed files')).toBeVisible({ timeout: 10_000 });

    // Back to uncommitted for the remaining tests.
    await page.getByTestId('changes-mode-uncommitted').click();
    await expect(page.getByTestId('changes-row-index.ts')).toBeVisible({ timeout: 10_000 });
  });

  test('uncommitted mode shows status glyphs for added, modified, deleted, and renamed files', async () => {
    const { page } = app;
    await expect(page.getByTestId('changes-status-new-file.txt')).toHaveText('Added', { timeout: 10_000 });
    await expect(page.getByTestId('changes-status-index.ts')).toHaveText('Modified');
    await expect(page.getByTestId('changes-status-delete-me.txt')).toHaveText('Deleted');
    await expect(page.getByTestId('changes-status-renamed-notes.md')).toHaveText('Renamed');
  });

  test('clicking a changed file row opens a HEAD-vs-working diff tab', async () => {
    const { page } = app;
    await page.getByTestId('changes-row-index.ts').click();
    const diffTab = page.getByTestId('diff-tab');
    await expect(diffTab).toBeVisible({ timeout: 10_000 });
    await expect(diffTab).not.toContainText('No diff available');
  });

  test('the changes refresh button re-fetches the row set', async () => {
    const { page } = app;
    await expect(page.getByTestId('changes-row-another-change.txt')).toHaveCount(0);
    writeFileSync(path.join(project.projectPath, 'another-change.txt'), 'more\n');
    await page.getByTestId('inspector-tab-changes').click();
    await page.getByTestId('changes-refresh').click();
    await expect(page.getByTestId('changes-row-another-change.txt')).toBeVisible({ timeout: 10_000 });
  });

  // ── FilePickerDialog ──────────────────────────────────────────────────────

  test('the file picker opens from the tab-strip add button with the search hint', async () => {
    const { page } = app;
    await ensureFilesSurfaceOn(page);
    await page.getByTestId('files-tab-strip-add').click();
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
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab', { selected: true })).toContainText('CLAUDE.md');
  });

  test('the file picker shows a no-match empty state for an unmatched query', async () => {
    const { page } = app;
    await page.getByTestId('files-tab-strip-add').click();
    const input = page.getByTestId('file-picker-input');
    await input.fill('zzz-does-not-exist');
    await expect(page.getByText('No matching files')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });
});
