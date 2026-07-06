/**
 * §find-in-path — FindInPathModal specs (spec #24 of docs/plans/2026-07-03-tauri-e2e-test-plan.md).
 *
 * UI-only: no recording needed (no agent turn). One project + one chat created in
 * `beforeAll`; fixture files are written directly to the project's temp dir (via
 * node `fs`) BEFORE the file tree first mounts, so the daemon's initial tree fetch
 * picks them up with no reload.
 *
 * Open path (verified against source — deviates from the plan text): there is NO
 * global hotkey wired to `open-find-in-path`. `use-global-overlay-hotkeys.ts` only
 * registers Cmd/Ctrl+O (search palette) and Cmd/Ctrl+Shift+R (review); Cmd/Ctrl+F is
 * a DIFFERENT feature (`use-find-hotkey.ts` → find-in-chat). The only entry points
 * are the file-tree row context-menu items `file-tree-find-in-file` /
 * `file-tree-find-in-folder` (`FileTreeRowMenu.tsx`), which this spec uses
 * exclusively.
 *
 * Testid reference (verified against packages/ui/src):
 *   main-toolbar-inspector          — reveals the Inspector (file tree)
 *   file-tree                       — tree root
 *   file-tree-row-${path}           — a tree row (file or folder)
 *   file-tree-find-in-file          — context-menu item on a file row
 *   file-tree-find-in-folder        — context-menu item on a folder row
 *   find-in-path                    — FindInPathModal DialogContent root
 *   find-in-path-input              — search input
 *   find-in-path-include-ignored    — checkbox, directory scope only
 *   find-in-path-hint               — "Type at least 2 characters to search" (query.length===1)
 *   find-in-path-idle-hint          — "Type to search" (query empty)
 *   find-in-path-empty              — "No matches" (debounced query >=2 chars, 0 results)
 *   find-in-path-result-${file}:${line}:${column} — a result row
 *   files-tab-strip                 — Files surface tab strip (role="tab" pills)
 *   viewer-shell-status             — footer status string ("Ln x, Col y" for code files)
 *
 * Cursor-position assertions expect the true 1-based match position rendered in
 * the footer: FindInPathModal converts the daemon's 1-based search hits to the
 * 0-based `open-file` reveal contract at the emit site (an off-by-one there was
 * found by this spec and fixed in `fix(ui): find-in-path passes 0-based reveal
 * coordinates`).
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

// ── Fixture content ────────────────────────────────────────────────────────────
// Every file is written WITHOUT a trailing newline so its CM6 document has exactly
// as many lines as entries below (no phantom trailing empty line), which keeps the
// hand-traced cursor math in the "clicking a result" / "Enter" tests exact.

// Match "zzqneedle" on line 3 (1-based), column 7 (1-based: 0-indexed offset 6).
const ALPHA_TS = [
  'export const alpha = 1;',
  'export const beta = 2;',
  "const zzqneedle = 'first hit';",
  'export const gamma = 3;',
  'export const delta = 4;',
].join('\n');

// Match "zzqneedle" on line 2 (1-based), column 17 (1-based: 0-indexed offset 16).
const BETA_TS = ['export const one = 1;', 'export function zzqneedle() {}'].join('\n');

// Match "uniqmarker" on line 2 (1-based), column 7 (1-based: 0-indexed offset 6).
const GAMMA_TS = ['export const x = 1;', 'const uniqmarker = 42;', 'export const y = 2;'].join('\n');

test.describe('§find-in-path', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    const dir = project.projectPath;

    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'alpha.ts'), ALPHA_TS);
    writeFileSync(path.join(dir, 'src', 'beta.ts'), BETA_TS);
    writeFileSync(path.join(dir, 'src', 'gamma.ts'), GAMMA_TS);

    await createTauriChat(app.page, project.projectId, 'default');

    const { page } = app;
    await page.getByTestId('main-toolbar-inspector').click();
    await page.getByTestId('file-tree').waitFor({ timeout: 10_000 });
    // Expand src/ once — it stays expanded for every test below (same page, no reload).
    await page.getByTestId('file-tree-row-src').click();
    await page.getByTestId('file-tree-row-src/alpha.ts').waitFor({ timeout: 10_000 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('opens scoped to a single file from the "Find in file" context-menu item', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src/alpha.ts').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-file').click();

    const dialog = page.getByTestId('find-in-path');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText('Find in file: src/alpha.ts');
    await expect(page.getByTestId('find-in-path-input')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });

  test('opens scoped to a directory from the "Find in folder" context-menu item', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-folder').click();

    const dialog = page.getByTestId('find-in-path');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText('Find in: src');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });

  test('shows the idle hint when empty and the below-threshold hint at 1 character', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-folder').click();
    const input = page.getByTestId('find-in-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Idle: no query typed yet.
    await expect(page.getByTestId('find-in-path-idle-hint')).toHaveText('Type to search');
    await expect(page.getByTestId('find-in-path-hint')).toHaveCount(0);

    // 1 character: below the 2-char search threshold.
    await input.fill('z');
    await expect(page.getByTestId('find-in-path-hint')).toHaveText('Type at least 2 characters to search');
    await expect(page.getByTestId('find-in-path-idle-hint')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });

  test('directory scope: debounced results are grouped by file and include-ignored is offered', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-folder').click();
    const input = page.getByTestId('find-in-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    await expect(page.getByTestId('find-in-path-include-ignored')).toBeVisible();

    await input.fill('zzqneedle');
    await expect(page.getByTestId('find-in-path-result-src/alpha.ts:3:7')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('find-in-path-result-src/beta.ts:2:17')).toBeVisible();

    // Grouped by file: one sticky header per matched file.
    await expect(page.getByRole('group', { name: 'src/alpha.ts' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'src/beta.ts' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });

  test('directory scope: shows the no-matches state for a non-matching query', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-folder').click();
    const input = page.getByTestId('find-in-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.fill('nomatchxyz123');
    await expect(page.getByTestId('find-in-path-empty')).toHaveText('No matches', { timeout: 5_000 });
    await expect(page.getByTestId('find-in-path-result-src/alpha.ts:3:7')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });

  test('file scope: results are limited to the scoped file and include-ignored is not offered', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src/alpha.ts').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-file').click();
    const input = page.getByTestId('find-in-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    await expect(page.getByTestId('find-in-path-include-ignored')).toHaveCount(0);

    await input.fill('zzqneedle');
    await expect(page.getByTestId('find-in-path-result-src/alpha.ts:3:7')).toBeVisible({ timeout: 5_000 });
    // beta.ts also contains "zzqneedle" but is out of the file scope.
    await expect(page.getByTestId('find-in-path-result-src/beta.ts:2:17')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });

  test('clicking a result opens the matched file in the editor', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src/alpha.ts').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-file').click();
    const input = page.getByTestId('find-in-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.fill('zzqneedle');
    const result = page.getByTestId('find-in-path-result-src/alpha.ts:3:7');
    await expect(result).toBeVisible({ timeout: 5_000 });
    await result.click();

    // Dialog closes and the Files surface opens the matched file.
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab', { selected: true })).toContainText('alpha.ts', { timeout: 10_000 });

    await expect(page.getByTestId('viewer-shell-status')).toHaveText('Ln 3, Col 7', { timeout: 5_000 });
  });

  test('Enter opens the active result via the keyboard', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src/gamma.ts').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-file').click();
    const input = page.getByTestId('find-in-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.fill('uniqmarker');
    await expect(page.getByTestId('find-in-path-result-src/gamma.ts:2:7')).toBeVisible({ timeout: 5_000 });

    await input.press('ArrowDown');
    await input.press('Enter');

    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab', { selected: true })).toContainText('gamma.ts', { timeout: 10_000 });

    await expect(page.getByTestId('viewer-shell-status')).toHaveText('Ln 2, Col 7', { timeout: 5_000 });
  });

  test('Escape closes the dialog', async () => {
    const { page } = app;
    await page.getByTestId('file-tree-row-src/beta.ts').click({ button: 'right' });
    await page.getByTestId('file-tree-find-in-file').click();
    await expect(page.getByTestId('find-in-path-input')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('find-in-path')).toHaveCount(0);
  });
});
