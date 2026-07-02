/**
 * §review-panel — the Cmd+Shift+R Review Changes modal.
 *
 * Cluster D, spec #28 of docs/plans/2026-07-03-tauri-e2e-test-plan.md.
 *
 * Source read: packages/ui/src/features/review/{ReviewPanel,ReviewPanelHeader,
 * ReviewFileTree,ReviewDiffPane,ReviewFileToolbar,ReviewDiffView,ReviewCommitRail,
 * use-review-data,git-status-to-files}.tsx, features/editor/CmDiffEditor.tsx,
 * features/chat/messages/{UserMessage,ReviewCommentCard}.tsx,
 * features/chat/view-model/parse-review-comment.ts, lib/format-line-comment.ts,
 * store/{overlays,intent-subscriber}.ts, app/use-global-overlay-hotkeys.ts,
 * lib/git-status-kind.ts, packages/core/src/server/routes/types.ts (getEffectivePath),
 * packages/core/src/git/git-service.ts (workingStat/commitAll).
 *
 * Entry point + worktree note: the header's `chat-header-review` button IS
 * disabled without a worktree (that gating is already fully covered by
 * chat-header.spec.ts's "review button (worktree gate)" describe — not
 * duplicated here). The global `⌘⇧R` hotkey (`use-global-overlay-hotkeys.ts`)
 * bypasses that button entirely and always opens the panel. `useReviewData`
 * only needs a `projectId`; the daemon's `getEffectivePath(ctx, projectId,
 * chatId)` (routes/types.ts:57) falls back to the *project's own path* whenever
 * the chat has no `worktreePath` — so a plain chat on the project's own dirty
 * git repo is sufficient. Every scenario below uses `⌘⇧R` on a non-worktree chat.
 *
 * Fixture: `dirtyRepo()` commits the project's default files (CLAUDE.md,
 * index.ts) as a clean baseline, then makes exactly 3 changes: two pure-append
 * modifications (+1/-0 each, so stat/diff assertions never depend on git's
 * line-rewrite heuristics) and one untracked 3-line addition. This yields a
 * deterministic +5/-0 across 3 files every run.
 *
 * Testid reference (verified against source):
 *   review-modal                 — Dialog content root
 *   review-close                 — header "X" button
 *   review-branch-badge          — header branch chip (only rendered when branch != null)
 *   review-file-counts           — header "{n} files · +A −D"
 *   review-viewed-counter        — header "{viewed}/{total} viewed"
 *   review-file-row-<path>       — ReviewFileTree row (click to select)
 *   review-file-stat-<path>      — per-file 5-square +/- meter
 *   review-file-tree-empty       — empty state (not exercised — fixture always dirties)
 *   review-open-in-workspace     — toolbar "Open in workspace"
 *   review-viewed-toggle         — toolbar Viewed checkbox (aria-pressed)
 *   editor-diff                  — CmDiffEditor (MergeView) host
 *   review-comment-selected-line — "Line N — snippet" once a diff line is clicked
 *   review-comment-input         — comment textarea
 *   review-comment-submit        — comment submit button (disabled until line+text)
 *   review-commit-input          — commit message textarea
 *   review-commit-suggestion-<word> — prefix chip (feat/fix/refactor/chore/docs)
 *   review-commit-unviewed-warning  — "{n} files not yet reviewed."
 *   review-commit-submit         — Commit button (disabled until message + fileCount>0)
 *   review-commit-cancel         — Cancel button (pre-commit)
 *   review-commit-done           — "Done" button (post-commit success state)
 *   review-commit-error          — commit failure message
 *   chat-user-review-comment     — the parsed review-comment message card
 *   chat-user-review-comment-L<n> — a single comment section within that card
 *   files-tab-strip [role="tab"] — Files surface tab strip (open-in-workspace target)
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { appendFileSync, writeFileSync } from 'fs';
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

/**
 * Deterministically dirty a freshly-seeded project repo with exactly 3 changed
 * files. `createTauriProject` already wrote CLAUDE.md + index.ts (untracked) —
 * commit them first so the appends below land as "M" changes (not "A"), then
 * append one new line to each (pure additions, no deletions) and add one
 * untracked 3-line file. Totals: 3 files, +5/-0.
 */
function dirtyRepo(dir: string): void {
  git(dir, ['add', '-A']);
  gitCommit(dir, 'baseline');

  appendFileSync(path.join(dir, 'index.ts'), 'export const farewell = "bye";\n');
  appendFileSync(path.join(dir, 'CLAUDE.md'), 'E2E dirty marker line.\n');
  writeFileSync(path.join(dir, 'new-file.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
}

const EXPECTED_FILES = ['CLAUDE.md', 'index.ts', 'new-file.ts'];

async function openReview(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+R');
  await expect(page.getByTestId('review-modal')).toBeVisible({ timeout: 10_000 });
}

// ─── Layout, file list, diff, viewed toggle, open-in-workspace ────────────────
//
// One shared fixture; tests run sequentially and build on each other's
// selection state (matches the chaining style already used by editor.spec.ts
// and files-tree.spec.ts). No AI turn is involved — no recording needed.

test.describe('§review-panel — layout, files, diff, viewed toggle', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    dirtyRepo(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('⌘⇧R opens a 3-column modal with correct file rows/stats and the first file auto-selected', async () => {
    const { page } = app;
    await openReview(page);

    await expect(page.getByTestId('review-branch-badge')).toHaveText(/main/);

    const countsText = (await page.getByTestId('review-file-counts').textContent()) ?? '';
    expect(countsText).toContain('3 files');
    expect(countsText).toContain('+5');
    expect(countsText).toContain('−0'); // − 0 deletions (U+2212 minus sign)

    for (const file of EXPECTED_FILES) {
      await expect(page.getByTestId(`review-file-row-${file}`)).toBeVisible();
      await expect(page.getByTestId(`review-file-stat-${file}`)).toBeVisible();
    }
    await expect(page.locator('[data-testid^="review-file-row-"]')).toHaveCount(3);

    // Auto-select: whichever file rendered first in the list carries the
    // selection tint, and its diff loads into the center pane.
    const firstRow = page.locator('[data-testid^="review-file-row-"]').first();
    await expect(firstRow).toHaveClass(/bg-mf-selection/);
    await expect(page.getByTestId('review-viewed-toggle')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('review-viewed-counter')).toHaveText(/0\/3 viewed/);

    // Diff renders side-by-side (CmDiffEditor / MergeView: two `.cm-content` panes).
    const diffRoot = page.getByTestId('editor-diff');
    await expect(diffRoot).toBeVisible({ timeout: 10_000 });
    await expect(diffRoot.locator('.cm-content')).toHaveCount(2);
  });

  test('clicking a file row selects it and swaps the diff to that file', async () => {
    const { page } = app;
    await page.getByTestId('review-file-row-index.ts').click();
    await expect(page.getByTestId('review-file-row-index.ts')).toHaveClass(/bg-mf-selection/);
    await expect(page.getByTestId('review-file-row-CLAUDE.md')).not.toHaveClass(/bg-mf-selection/);

    const diffRoot = page.getByTestId('editor-diff');
    const modifiedPane = diffRoot.locator('.cm-content').nth(1);
    await expect(modifiedPane).toContainText('farewell', { timeout: 10_000 });
  });

  test('the Viewed toggle marks the file viewed and advances the header progress counter', async () => {
    const { page } = app;
    // index.ts is selected from the previous test.
    const toggle = page.getByTestId('review-viewed-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('review-viewed-counter')).toHaveText(/1\/3 viewed/);

    // The filename gets a strikethrough as soon as it's viewed, even while
    // still selected (ReviewFileTree.tsx: line-through is unconditional on
    // `isViewed`; the opacity dim below is conditional on `!isSelected`).
    const indexRow = page.getByTestId('review-file-row-index.ts');
    await expect(indexRow.locator('span.line-through')).toHaveCount(1);

    // Selecting a different file drops the tint from index.ts, revealing the
    // "viewed but not active" dimmed treatment.
    await page.getByTestId('review-file-row-new-file.ts').click();
    await expect(indexRow).toHaveClass(/opacity-55/);
  });

  test('Open in workspace closes the modal and opens the file in the Files surface', async () => {
    const { page } = app;
    // new-file.ts is selected from the previous test.
    await page.getByTestId('review-open-in-workspace').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0);

    const tab = page.locator('[data-testid="files-tab-strip"] [role="tab"]').filter({ hasText: 'new-file.ts' });
    await expect(tab).toBeVisible({ timeout: 10_000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── Comment on a diff line → posted to chat ──────────────────────────────────
//
// Posting a comment goes through the real runtime.append → onNew →
// controller.sendMessage path (ReviewPanel.tsx handleAppend), the same one a
// composer send uses — so it needs a live chat and, when E2E_MODE=mock, a
// recording. `thread` is reused (content-agnostic replay — see mock-cli
// DESIGN.md's "positional is sufficient"); this test never inspects the
// assistant's reply, only that the user turn it produces renders.

test.describe('§review-panel — comment to chat', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'thread' });
    project = await createTauriProject(app.page);
    dirtyRepo(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('selecting a diff line and submitting a comment appends a ReviewCommentCard to the chat', async () => {
    const { page } = app;
    await openReview(page);

    await page.getByTestId('review-file-row-index.ts').click();
    const diffRoot = page.getByTestId('editor-diff');
    const modifiedPane = diffRoot.locator('.cm-content').nth(1);
    await expect(modifiedPane.locator('.cm-line')).toHaveCount(2, { timeout: 10_000 });

    // Line 2 is the appended line (`export const farewell = "bye";` — see dirtyRepo()).
    await modifiedPane.locator('.cm-line').nth(1).click();
    await expect(page.getByTestId('review-comment-selected-line')).toHaveText(/Line 2/, { timeout: 5_000 });

    await page.getByTestId('review-comment-input').fill('Should this be a template literal?');
    const submit = page.getByTestId('review-comment-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    // The form clears; the panel itself stays open (only the commit flow closes it).
    await expect(page.getByTestId('review-comment-input')).toHaveValue('');
    await expect(page.getByTestId('review-comment-selected-line')).toHaveCount(0);

    await page.getByTestId('review-close').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0);

    const card = page.getByTestId('chat-user-review-comment');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('index.ts');
    const section = page.getByTestId('chat-user-review-comment-L2');
    await expect(section).toBeVisible();
    await expect(section).toContainText('Should this be a template literal?');
  });
});

// ─── Commit rail ───────────────────────────────────────────────────────────────

test.describe('§review-panel — commit rail', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    dirtyRepo(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    await openReview(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('submit is disabled until a commit message is entered', async () => {
    const { page } = app;
    await expect(page.getByTestId('review-commit-submit')).toBeDisabled();
  });

  test('a suggestion chip prefixes the commit message and enables submit', async () => {
    const { page } = app;
    await page.getByTestId('review-commit-suggestion-feat').click();
    await expect(page.getByTestId('review-commit-input')).toHaveValue('feat: ');
    await expect(page.getByTestId('review-commit-submit')).toBeEnabled();
  });

  test('unviewed files are flagged before commit', async () => {
    const { page } = app;
    // None of the 3 changed files have been marked Viewed in this describe.
    await expect(page.getByTestId('review-commit-unviewed-warning')).toContainText('3 files not yet reviewed.');
  });

  test('committing stages and commits every changed file, showing the done state', async () => {
    const { page } = app;
    await page.getByTestId('review-commit-input').fill('e2e: dirty-repo review commit');
    await page.getByTestId('review-commit-submit').click();
    await expect(page.getByTestId('review-commit-done')).toBeVisible({ timeout: 15_000 });

    // commitAll stages every changed file (git add -A + commit) — the
    // repository must be fully clean afterward.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: project.projectPath }).toString();
    expect(status.trim()).toBe('');
  });

  test('the Done button closes the review modal', async () => {
    const { page } = app;
    await page.getByTestId('review-commit-done').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0);
  });
});

// ─── Close controls (Cancel / header X / Escape) ──────────────────────────────

test.describe('§review-panel — close controls', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    dirtyRepo(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the commit rail Cancel button closes the panel', async () => {
    const { page } = app;
    await openReview(page);
    await page.getByTestId('review-commit-cancel').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0);
  });

  test('the header close button closes the panel', async () => {
    const { page } = app;
    await openReview(page);
    await page.getByTestId('review-close').click();
    await expect(page.getByTestId('review-modal')).toHaveCount(0);
  });

  test('Escape closes the panel', async () => {
    const { page } = app;
    await openReview(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('review-modal')).toHaveCount(0);
  });
});
