/**
 * §sessions — Sessions sidebar + external-import specs for app-tauri browser mode.
 *
 * Ported from:
 *   Session CRUD, filtering, and external-session import coverage.
 *
 * All tests run in E2E_MODE=mock (no AI). Tests use REST-seeded chats and seed
 * external JSONL files for the import suite.
 *
 * Testid reference (verified against packages/ui/src/v2/features/sessions/):
 *   sessions-row                  — each session row (data-chat-id attr)
 *   sessions-new-button           — + new session button
 *   sessions-more-button          — ⋯ overflow menu trigger
 *   sessions-more-archived        — dropdown item: Archived sessions
 *   sessions-more-import          — dropdown item: Import external sessions
 *   sessions-row-action-pin/-tags/-archive — hover actions, mounted on row hover
 *                                   (SessionRowHoverActions.tsx). There is no
 *                                   `sessions-row-action-rename`: Rename is
 *                                   context-menu-only.
 *   sessions-ctx-rename           — right-click menu item: Rename (SessionContextMenu.tsx)
 *   sessions-rename-input         — inline rename input (replaces the row's title)
 *   sessions-row-title            — the title span
 *   sessions-archive-confirm-dialog — dialog root (worktree-backed chats only)
 *   sessions-archived-dialog      — archived sessions dialog
 *   archived-session-item         — row inside archived dialog
 *   restore-session-btn           — restore button in archived dialog
 *   sessions-import-dialog        — import dialog root
 *   sessions-import-project-<id>  — project picker button in import dialog
 *   external-session-item         — row in session list inside import dialog
 *   import-session-btn            — Import button on each external-session row
 *   sessions-welcome / welcome-project — the projectless draft's welcome screen and
 *                                   its project picker (see the note below)
 *   daemon-footer-trigger         — sidebar footer daemon status (used for readiness waits)
 *   sessions-archive-keep-worktree   — ArchiveWorktreeDialog "Keep worktree" button
 *   sessions-archive-delete-worktree — ArchiveWorktreeDialog "Delete worktree" button
 *   sessions-import-load-more     — ImportSessionList paging sentinel (IntersectionObserver),
 *                                   hung on the windowed list's FOOTER — see the pagination
 *                                   describe: it only mounts once the list end is scrolled
 *                                   into view
 *   sessions-import-retry         — ImportSessionList "Try again" button (fetch error state)
 *
 * Both dialog lists are WINDOWED now (DialogRowList.tsx → react-virtuoso, ~340px of
 * rows mounted), so a row count is a count of what fits, not of what exists. Rows
 * carry Virtuoso's `data-item-index`, which is what the pagination block asserts on.
 *
 * THE ZERO-SESSION BOOT IS NO LONGER A MODAL DEAD-END: `useZeroSessionBootPicker`
 * and the force-opened `sessions-new-picker` DropdownMenu are gone. A boot with
 * projects > 0 and no sessions lands on the draft's WELCOME SCREEN, which owns the
 * project choice inline (`welcome-project`) — no modal layer sits over the sidebar,
 * so the §35 describes no longer dismiss anything in `beforeAll`.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { closeMenus, waitForDialogScrimsGone } from '../helpers/tauri/menus.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// ── external-session seed helpers (ported from 35-external-sessions.spec.ts) ──

/** Encode a project path the same way the Claude adapter does. */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Create a fake JSONL session file in the Claude project directory. */
function seedExternalSession(
  projectPath: string,
  sessionId: string,
  opts: { firstPrompt?: string; gitBranch?: string } = {},
): string {
  const claudeDir = path.join(homedir(), '.claude', 'projects', encodeProjectPath(projectPath));
  mkdirSync(claudeDir, { recursive: true });
  const filePath = path.join(claudeDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      gitBranch: opts.gitBranch ?? 'main',
      cwd: projectPath,
      message: {
        content: [{ type: 'text', text: opts.firstPrompt ?? 'Test external session' }],
      },
    }),
  ];
  writeFileSync(filePath, lines.join('\n') + '\n');
  return claudeDir;
}

/** Deterministic UUID-shaped session id for bulk pagination fixtures (see isUuidJsonl,
 *  external-session-paths.ts) — every group segment is fixed except the last (12 hex
 *  chars), which carries the zero-padded index so ids stay unique and lowercase-hex-valid. */
function uuidForIndex(n: number): string {
  return `eeeeeeee-eeee-4eee-8eee-${n.toString(16).padStart(12, '0')}`;
}

// ── import dialog helpers ────────────────────────────────────────────────────

/**
 * Open the import dialog and advance past step 1 onto the session list.
 *
 * With no project filter active `ImportSessionsDialog` always renders the project
 * picker first, so the pick is unconditional. The two waits before it are the
 * layers that otherwise eat these clicks: a ⋯ menu still mounted through its exit
 * animation swallows the trigger click that reopens it, and a dialog's overlay
 * outlives its content's unmount, so a dialog reopened under the previous one's
 * fading scrim has every click inside it intercepted.
 */
async function openImportForProject(page: Page, projectId: string): Promise<void> {
  await closeMenus(page);
  await waitForDialogScrimsGone(page);
  await sessionsSidebar(page).openImport();
  await expect(page.getByTestId('sessions-import-dialog')).toBeVisible({ timeout: 5_000 });
  await sessionsSidebar(page).importProjectOption(projectId).click({ timeout: 10_000 });
}

/** Dismiss the import dialog and PROVE the content is gone — an unverified Escape
 *  used to leave a modal dialog stacked under the next test's dialog. The scrim is
 *  waited out on the OPEN side (`openImportForProject`), where it also covers the
 *  dialogs this suite closes by importing rather than by Escape. */
async function closeImportDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sessions-import-dialog')).toHaveCount(0, { timeout: 5_000 });
}

// ─── §45 Sessions panel ───────────────────────────────────────────────────────

test.describe('§45 Sessions panel', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // Seed one chat so there is something in the list before the tests run.
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // SP1: new-session button behaviour.
  //
  // The anchored "NEW SESSION IN…" popover is gone: the "+" is ONE CLICK and
  // opens a projectless draft whose WELCOME SCREEN owns the project choice
  // (`welcome-project` → `welcome-project-<id>`). Until a project is picked the
  // draft has no config, so the sidebar shows no draft row, the composer stays
  // hidden, and — the D3 invariant this test really guards — no chat and no
  // `sessions-row` exists yet.
  test('SP1: new-session button opens the welcome screen project picker (no filter active)', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowsBefore = await page.getByTestId('sessions-row').count();

    await sidebar.newButton().click();

    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('welcome-project')).toBeVisible();
    // Nothing to send into yet — the composer only mounts once a project resolves.
    await expect(page.getByTestId('chat-composer-input')).toHaveCount(0);

    // No draft row and no session: the project pick precedes any draft config,
    // and the chat itself is still created on first send only.
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0);
    const rowsAfter = await page.getByTestId('sessions-row').count();
    expect(rowsAfter).toBe(rowsBefore);
  });

  // SP6: rename a session.
  test('SP6: rename a session', async () => {
    const { page } = app;
    // Use the first real (non-draft) sessions-row.
    const firstRow = page.getByTestId('sessions-row').first();
    await firstRow.waitFor({ timeout: 10_000 });

    // The inline rename hover action was removed (SessionRowHoverActions.tsx —
    // hover keeps pin/tags/archive only); Rename lives in the right-click
    // context menu (SessionContextMenu, D11).
    await firstRow.click({ button: 'right' });
    await page.getByTestId('sessions-ctx-rename').click();

    const input = page.getByTestId('sessions-rename-input').first();
    await input.waitFor({ timeout: 5_000 });
    await input.fill('Renamed session');
    await input.press('Enter');

    await expect(page.getByTestId('sessions-row-title').filter({ hasText: 'Renamed session' }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  // SP8: archive a session.
  test('SP8: archive a session', async () => {
    const { page } = app;
    const rows = page.getByTestId('sessions-row');
    const countBefore = await rows.count();

    // Hover the first row and click the archive action.
    await rows.first().hover();
    await page
      .getByTestId('sessions-row-action-archive')
      .first()
      .evaluate((el) => (el as HTMLElement).click());

    // A chat with NO worktree has nothing to decide, so it archives with no prompt.
    await expect(rows).toHaveCount(countBefore - 1, { timeout: 10_000 });
    await expect(page.getByTestId('sessions-archive-confirm-dialog')).toHaveCount(0);
  });

  // SP9: view and restore an archived session.
  test('SP9: view and restore an archived session', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // Reload so the ArchivedSessionsDialog's runtime-backed list includes the
    // just-archived chat (the native thread list reloads from the daemon on reconnect).
    await page.reload();
    await waitConnected(page);

    // Open archived sessions via the ⋯ more menu.
    await sidebar.openArchived();

    const archivedDialog = page.getByTestId('sessions-archived-dialog');
    await archivedDialog.waitFor({ timeout: 5_000 });

    const archivedItems = page.getByTestId('archived-session-item');
    await expect(archivedItems.first()).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('restore-session-btn').first().click();

    // After restore the thread list reloads; the restored row should appear in
    // the active sidebar (may need a moment).
    await expect(page.getByTestId('sessions-row').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ─── §45 Sessions panel — archive dialog worktree branch ─────────────────────
//
// SP8 above covers the NO-worktree path, where archiving raises no dialog at all.
// This block covers the only path that asks — a chat WITH a worktree, whose fate
// is the question — and exercises BOTH answers end to end, asserting the worktree
// directory's fate on disk via node:fs (not just the dialog UI).
//
// The row reads `custom.worktreePath` off its own thread-list entry (SessionRow →
// useArchiveSession), so a chat REST-seeded with a worktree needs that entry
// refreshed before the click: hence the reload in beforeAll.
test.describe('§45 Sessions panel — archive dialog worktree branch', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatKeep: string;
  let chatDelete: string;
  let worktreePathKeep: string;
  let worktreePathDelete: string;

  /** REST-enable a worktree on `chatId` and return its resolved worktreePath (read back
   *  via GET /api/chats/:id so the on-disk path is known independent of the dialog). */
  async function enableWorktree(chatId: string, branchName: string): Promise<string> {
    const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/enable-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseBranch: 'main', branchName }),
    });
    expect(res.ok).toBe(true);

    const chatRes = await fetch(`${DAEMON_BASE}/api/chats/${chatId}`);
    const body = (await chatRes.json()) as { data?: { worktreePath?: string } };
    const worktreePath = body.data?.worktreePath;
    if (!worktreePath) throw new Error(`enableWorktree: chat ${chatId} has no worktreePath after enabling`);
    return worktreePath;
  }

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatKeep = await createTauriChat(app.page, project.projectId, 'default');
    chatDelete = await createTauriChat(app.page, project.projectId, 'default');
    worktreePathKeep = await enableWorktree(chatKeep, 'e2e-archive-keep');
    worktreePathDelete = await enableWorktree(chatDelete, 'e2e-archive-delete');
    // Re-derive the thread list so both rows carry the freshly-seeded worktreePath.
    await app.page.reload();
    await waitConnected(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a chat with a worktree is asked about it before archiving, and Keep spares the directory', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const row = sidebar.row(chatKeep);
    await row.waitFor({ timeout: 10_000 });
    await row.hover();
    await row.getByTestId('sessions-row-action-archive').evaluate((el) => (el as HTMLElement).click());

    const confirmDialog = page.getByTestId('sessions-archive-confirm-dialog');
    await confirmDialog.waitFor({ timeout: 5_000 });
    await expect(page.getByTestId('sessions-archive-keep-worktree')).toBeVisible();
    await expect(page.getByTestId('sessions-archive-delete-worktree')).toBeVisible();
    // The row is still in the list: nothing is archived until the question is answered.
    await expect(row).toHaveCount(1);

    // Keep worktree — the row leaves the active list but the directory survives on disk.
    await page.getByTestId('sessions-archive-keep-worktree').click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    await expect.poll(() => existsSync(worktreePathKeep), { timeout: 10_000 }).toBe(true);
  });

  test('deleting the worktree removes the directory from disk', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const row = sidebar.row(chatDelete);
    await row.waitFor({ timeout: 10_000 });
    await row.hover();
    await row.getByTestId('sessions-row-action-archive').evaluate((el) => (el as HTMLElement).click());

    const confirmDialog = page.getByTestId('sessions-archive-confirm-dialog');
    await confirmDialog.waitFor({ timeout: 5_000 });
    await page.getByTestId('sessions-archive-delete-worktree').click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    await expect.poll(() => existsSync(worktreePathDelete), { timeout: 10_000 }).toBe(false);
  });
});

// ─── §35 External session import ─────────────────────────────────────────────

test.describe('§35 External session import', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let claudeDir: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);

    // Session ids must be UUID-shaped: the daemon's scanner (external-session-paths.ts
    // isUuidJsonl, matching real Claude CLI session file naming) filters out any <uuid>.jsonl
    // candidate whose stem isn't a UUID — a non-UUID id like the old 'ext-session-aaa' is
    // silently skipped, so the dialog always showed zero importable sessions.
    claudeDir = seedExternalSession(project.projectPath, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      firstPrompt: 'Fix the login bug',
      gitBranch: 'feat/login-fix',
    });
    seedExternalSession(project.projectPath, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      firstPrompt: 'Add unit tests for auth module',
      gitBranch: 'feat/auth-tests',
    });

    // Trigger the daemon's external-session scan for the project, then poll the
    // same endpoint until it reports both seeded sessions — the scan enriches
    // each candidate file (stat + JSONL parse) and can take a moment past the
    // first response, so a fixed sleep here is a flake vector.
    await app.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
    await expect
      .poll(
        async () => {
          const res = await app.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
          const body = await res.json();
          return body.data?.total ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test.afterAll(async () => {
    rmSync(claudeDir, { recursive: true, force: true });
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('import button is enabled when external sessions exist', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    // The more button must be visible and enabled first.
    await expect(page.getByTestId('sessions-more-button')).toBeVisible({ timeout: 10_000 });
    // Open the more menu to verify the import item is not disabled.
    await sidebar.openMore();
    const importItem = page.getByTestId('sessions-more-import');
    await expect(importItem).toBeVisible({ timeout: 5_000 });
    await expect(importItem).not.toHaveAttribute('data-disabled', 'true');
    await closeMenus(page);
  });

  test('opens dialog and shows importable sessions', async () => {
    const { page } = app;

    await openImportForProject(page, project.projectId);

    // Step 2: session list should show both seeded sessions.
    const items = page.getByTestId('external-session-item');
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    await expect(items.first()).toContainText(/(Fix the login bug|Add unit tests)/);

    await closeImportDialog(page);
  });

  test('imports a session and closes dialog', async () => {
    const { page } = app;

    await openImportForProject(page, project.projectId);

    const items = page.getByTestId('external-session-item');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });

    const rowsBefore = await page.getByTestId('sessions-row').count();

    await items.first().getByTestId('import-session-btn').click();

    // Dialog closes after import.
    await expect(page.getByTestId('sessions-import-dialog')).toHaveCount(0, { timeout: 10_000 });

    // Sessions list gains one row.
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 10_000 });
  });

  test('imported session has a title', async () => {
    const { page } = app;
    const firstRow = page.getByTestId('sessions-row').first();
    const titleEl = firstRow.getByTestId('sessions-row-title');
    await expect(titleEl).toBeVisible({ timeout: 5_000 });
    const text = await titleEl.textContent();
    expect(text).not.toBe('Untitled session');
  });

  // NOTE: app-tauri has a known navigation race where a chat.updated broadcast
  // can revert the active thread after an import triggers runtime.threads.reload().
  // See the `useSessionListRouter` reload→active-thread race documented in
  // chat.spec.ts. If this test fails due to that race, mark it fixme.
  test('import does not switch active chat', async () => {
    const { page } = app;

    // Select the first row as the active session.
    const firstRow = page.getByTestId('sessions-row').first();
    await firstRow.click();
    const activeTitleEl = firstRow.getByTestId('sessions-row-title');
    await expect(activeTitleEl).toBeVisible({ timeout: 5_000 });
    const activeTitleBefore = await activeTitleEl.textContent();

    // Active row has data-[active=true] on the sessions-row root.
    await expect(firstRow).toHaveAttribute('data-active', 'true', { timeout: 5_000 });

    // Open import dialog and import the remaining external session.
    await openImportForProject(page, project.projectId);

    const remaining = page.getByTestId('external-session-item').first();
    await expect(remaining).toBeVisible({ timeout: 10_000 });
    await remaining.getByTestId('import-session-btn').click();

    // Dialog closes.
    await expect(page.getByTestId('sessions-import-dialog')).toHaveCount(0, { timeout: 10_000 });

    // The originally-active row is still active (title unchanged).
    // Re-resolve the first row (the list may have re-ordered after reload).
    const activeRow = page.locator('[data-testid="sessions-row"][data-active="true"]');
    await expect(activeRow).toBeVisible({ timeout: 5_000 });
    const activeTitleAfter = await activeRow.getByTestId('sessions-row-title').textContent();
    expect(activeTitleAfter).toBe(activeTitleBefore);
  });
});

// ─── §35 External session import — pagination ────────────────────────────────
//
// `useExternalSessions` pages at PAGE=50 behind an IntersectionObserver on the
// `sessions-import-load-more` sentinel, so scrolling the sentinel into view
// triggers `loadMore()` for real — no observer mocking needed here (unlike the
// component test, which mocks it because jsdom has none).
//
// What changed with the v2 dialog: the list is WINDOWED (DialogRowList.tsx →
// react-virtuoso, MAX_HEIGHT 340), and the sentinel hangs off Virtuoso's Footer.
// So neither "50 rows are in the DOM" nor "the sentinel is visible on open" is
// true any more — only a screenful of rows is mounted, and the footer mounts
// only once the end of the list is scrolled into view. The observable paging
// contract is instead: scroll to the end → the sentinel appears → it pulls the
// next page → it retires when `nextOffset` goes null, at which point the LAST
// item's index is reachable. Rows carry Virtuoso's `data-item-index`, which is
// how the total is asserted without counting mounted nodes.
test.describe('§35 External session import — pagination', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let claudeDir: string;
  const TOTAL_SESSIONS = 55;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);

    for (let i = 0; i < TOTAL_SESSIONS; i++) {
      claudeDir = seedExternalSession(project.projectPath, uuidForIndex(i), {
        firstPrompt: `External session number ${i}`,
        gitBranch: 'main',
      });
    }

    // Trigger the daemon's external-session scan for the project (same pre-warm
    // pattern as the §35 import block above).
    await app.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
  });

  test.afterAll(async () => {
    rmSync(claudeDir, { recursive: true, force: true });
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  /** Drive the windowed list to its current end. */
  async function scrollListToEnd(page: Page): Promise<void> {
    await page
      .locator('[data-testid="sessions-import-dialog"] [data-virtuoso-scroller="true"]')
      .evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  }

  test('the import dialog opens on the first page, windowed', async () => {
    const { page } = app;
    const importDialog = page.getByTestId('sessions-import-dialog');

    await openImportForProject(page, project.projectId);

    const items = page.getByTestId('external-session-item');
    await expect(items.first()).toBeVisible({ timeout: 20_000 });
    // The first page arrived (index 0 is the top of it) and the list is windowed:
    // a 55-session project mounts a screenful, not 55 rows.
    await expect(importDialog.locator('[data-item-index="0"]')).toHaveCount(1);
    expect(await items.count()).toBeLessThan(TOTAL_SESSIONS);
  });

  test('scrolling to the end pages in the rest, then retires the sentinel', async () => {
    const { page } = app;
    const importDialog = page.getByTestId('sessions-import-dialog');
    const sentinel = page.getByTestId('sessions-import-load-more');

    // Each scroll to the end mounts the footer sentinel, which the observer turns
    // into a `loadMore()`; the growing list then pushes the end further down. Poll
    // the scroll rather than waiting a fixed beat for the fetch.
    await expect
      .poll(
        async () => {
          await scrollListToEnd(page);
          return sentinel.count();
        },
        { timeout: 20_000 },
      )
      .toBe(0);

    // Sentinel gone == nextOffset null == every page loaded. The last index is now
    // reachable, which is the count assertion a windowed list can actually make.
    await scrollListToEnd(page);
    await expect(importDialog.locator(`[data-item-index="${TOTAL_SESSIONS - 1}"]`)).toHaveCount(1, {
      timeout: 10_000,
    });

    await closeImportDialog(page);
  });
});

// ─── §35 External session import — retry on error ────────────────────────────
//
// Network-level fault injection via page.route on the GET external-sessions
// endpoint (getExternalSessions → request<T> throws on a non-ok response,
// which SessionList's fetch effect catches into the `error` state — the same
// path a real daemon 5xx or connection failure would take). Only the list GET
// is intercepted (matched by pathname, not method, so the import POST +
// load-more GETs on other pages are unaffected); the interception is one-shot
// via a closure flag so the `sessions-import-retry` click's re-fetch succeeds.
test.describe('§35 External session import — retry on error', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let claudeDir: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    claudeDir = seedExternalSession(project.projectPath, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      firstPrompt: 'Session recovered after retry',
      gitBranch: 'main',
    });
    await app.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
  });

  test.afterAll(async () => {
    rmSync(claudeDir, { recursive: true, force: true });
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a failed fetch shows the error state; retry recovers the list', async () => {
    const { page } = app;

    let failedOnce = false;
    await page.route(
      (url) => url.pathname.endsWith('/external-sessions'),
      async (route) => {
        if (route.request().method() === 'GET' && !failedOnce) {
          failedOnce = true;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'Injected e2e failure' }),
          });
          return;
        }
        await route.continue();
      },
    );

    await openImportForProject(page, project.projectId);

    const retryButton = page.getByTestId('sessions-import-retry');
    await expect(retryButton).toBeVisible({ timeout: 10_000 });
    // "Please try again" moved out of the message and into the Retry button asserted
    // above (use-external-sessions.ts sets the bare sentence).
    await expect(page.getByText('Failed to load sessions.')).toBeVisible();

    await retryButton.click();

    await expect(page.getByTestId('external-session-item')).toHaveCount(1, { timeout: 10_000 });
    await expect(retryButton).toHaveCount(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await closeImportDialog(page);
  });
});
