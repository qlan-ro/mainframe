/**
 * §sessions — Sessions sidebar + external-import specs for app-tauri browser mode.
 *
 * Ported from:
 *   packages/e2e/tests/45-sessions.spec.ts  (SP1, SP6, SP8, SP9)
 *   packages/e2e/tests/35-external-sessions.spec.ts (5 tests)
 *
 * All tests run in E2E_MODE=mock (no AI). Tests use REST-seeded chats and seed
 * external JSONL files for the import suite.
 *
 * Testid reference (app-tauri renames):
 *   sessions-row                  — each session row (data-chat-id attr)
 *   sessions-new-button           — + new session button
 *   sessions-more-button          — ⋯ overflow menu trigger
 *   sessions-more-archived        — dropdown item: Archived sessions
 *   sessions-more-import          — dropdown item: Import external sessions
 *   sessions-row-action-rename    — hover action: rename
 *   sessions-row-action-archive   — hover action: archive
 *   sessions-rename-input         — inline rename input
 *   sessions-row-title            — the title span
 *   sessions-archive-confirm-dialog — dialog root (worktree-backed chats only)
 *   sessions-archived-dialog      — archived sessions dialog
 *   archived-session-item         — row inside archived dialog
 *   restore-session-btn           — restore button in archived dialog
 *   sessions-import-dialog        — import dialog root
 *   sessions-import-project-<id> — project picker button in import dialog
 *   external-session-item         — row in session list inside import dialog
 *   import-session-btn            — Import button on each external-session row
 *   sessions-new-picker           — sidebar "New" project picker (no filter pill active)
 *   daemon-footer-trigger         — sidebar footer daemon status (used for readiness waits)
 *   sessions-archive-keep-worktree   — ArchiveWorktreeDialog "Keep worktree" button
 *   sessions-archive-delete-worktree — ArchiveWorktreeDialog "Delete worktree" button
 *   sessions-import-load-more     — ImportSessionsDialog infinite-scroll sentinel (IntersectionObserver)
 *   sessions-import-retry         — ImportSessionsDialog "Try again" button (fetch error state)
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
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
  // BEHAVIOUR DIFFERENCE vs desktop (documented):
  //   The in-composer "choose a project" picker (formerly NewThreadConfigPicker)
  //   is gone. When no project filter pill is active, the sidebar "New" button
  //   is wrapped in NewSessionPickerPopover (`sessions-new-picker`), which lists
  //   projects to pick from BEFORE any draft thread is created. Only picking a
  //   project row calls switchToNewThread() (draft-aware new-thread D3,
  //   app-tauri/CLAUDE.md) — so no `sessions-row` is created merely by opening
  //   the popover.
  test('SP1: new-session button shows project picker (no filter active)', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowsBefore = await page.getByTestId('sessions-row').count();

    await sidebar.newButton().click();

    // In "All" view (no project filter pill), clicking New opens the project
    // picker popover — NOT the composer directly.
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });

    // No draft/chat is created merely by opening the popover — the sessions-row
    // count should NOT increase before a project row is picked.
    const rowsAfter = await page.getByTestId('sessions-row').count();
    expect(rowsAfter).toBe(rowsBefore);

    // Close the popover so it doesn't linger over later tests.
    await page.keyboard.press('Escape');
  });

  // SP6: rename a session.
  test('SP6: rename a session', async () => {
    const { page } = app;
    // Use the first real (non-draft) sessions-row.
    const firstRow = page.getByTestId('sessions-row').first();
    await firstRow.waitFor({ timeout: 10_000 });
    await firstRow.hover();

    // Click the rename action via evaluate to avoid hover-timing flake.
    await page
      .getByTestId('sessions-row-action-rename')
      .first()
      .evaluate((el) => (el as HTMLElement).click());

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
    // Close the menu by pressing Escape.
    await page.keyboard.press('Escape');
  });

  test('opens dialog and shows importable sessions', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    await sidebar.openImport();

    const importDialog = page.getByTestId('sessions-import-dialog');
    await importDialog.waitFor({ timeout: 5_000 });

    // Step 1: project picker — click our project.
    const projectBtn = sidebar.importProjectOption(project.projectId);
    await projectBtn.waitFor({ timeout: 5_000 }).catch(() => {});
    if (await projectBtn.isVisible().catch(() => false)) {
      await projectBtn.click();
    }

    // Step 2: session list should show both seeded sessions.
    const items = page.getByTestId('external-session-item');
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    await expect(items.first()).toContainText(/(Fix the login bug|Add unit tests)/);

    // Close dialog for next test.
    await page.keyboard.press('Escape');
  });

  test('imports a session and closes dialog', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    await sidebar.openImport();
    const importDialog = page.getByTestId('sessions-import-dialog');
    await importDialog.waitFor({ timeout: 5_000 });

    const projectBtn = sidebar.importProjectOption(project.projectId);
    await projectBtn.waitFor({ timeout: 5_000 }).catch(() => {});
    if (await projectBtn.isVisible().catch(() => false)) {
      await projectBtn.click();
    }

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
    const sidebar = sessionsSidebar(page);

    // Select the first row as the active session.
    const firstRow = page.getByTestId('sessions-row').first();
    await firstRow.click();
    const activeTitleEl = firstRow.getByTestId('sessions-row-title');
    await expect(activeTitleEl).toBeVisible({ timeout: 5_000 });
    const activeTitleBefore = await activeTitleEl.textContent();

    // Active row has data-[active=true] on the sessions-row root.
    await expect(firstRow).toHaveAttribute('data-active', 'true', { timeout: 5_000 });

    // Open import dialog and import the remaining external session.
    await sidebar.openImport();
    const importDialog = page.getByTestId('sessions-import-dialog');
    await importDialog.waitFor({ timeout: 5_000 });

    const projectBtn = sidebar.importProjectOption(project.projectId);
    await projectBtn.waitFor({ timeout: 5_000 }).catch(() => {});
    if (await projectBtn.isVisible().catch(() => false)) {
      await projectBtn.click();
    }

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
// SessionList (ImportSessionsDialog.tsx) pages at PAGE=50 via an
// IntersectionObserver sentinel (`sessions-import-load-more`), no root option
// (defaults to the top-level viewport, but intersection is still clipped by the
// dialog's ScrollArea ancestor) — so scrolling the sentinel into view is enough
// to trigger `loadMore()` for real, no IntersectionObserver mocking needed here
// (unlike the component test, which mocks the observer because jsdom has none).
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

  test('the import dialog shows the first page (50 rows) and a load-more sentinel', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    await sidebar.openImport();
    const importDialog = page.getByTestId('sessions-import-dialog');
    await importDialog.waitFor({ timeout: 5_000 });

    const projectBtn = sidebar.importProjectOption(project.projectId);
    await projectBtn.waitFor({ timeout: 5_000 });
    await projectBtn.click();

    const items = page.getByTestId('external-session-item');
    await expect(items).toHaveCount(50, { timeout: 20_000 });
    await expect(page.getByTestId('sessions-import-load-more')).toBeVisible();
  });

  test('scrolling the sentinel into view loads page 2; the sentinel then disappears', async () => {
    const { page } = app;
    const sentinel = page.getByTestId('sessions-import-load-more');
    await sentinel.scrollIntoViewIfNeeded();

    const items = page.getByTestId('external-session-item');
    await expect(items).toHaveCount(TOTAL_SESSIONS, { timeout: 20_000 });
    await expect(page.getByTestId('sessions-import-load-more')).toHaveCount(0);

    await page.keyboard.press('Escape');
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
    const sidebar = sessionsSidebar(page);

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

    await sidebar.openImport();
    const importDialog = page.getByTestId('sessions-import-dialog');
    await importDialog.waitFor({ timeout: 5_000 });

    const projectBtn = sidebar.importProjectOption(project.projectId);
    await projectBtn.waitFor({ timeout: 5_000 });
    await projectBtn.click();

    const retryButton = page.getByTestId('sessions-import-retry');
    await expect(retryButton).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Failed to load sessions. Please try again.')).toBeVisible();

    await retryButton.click();

    await expect(page.getByTestId('external-session-item')).toHaveCount(1, { timeout: 10_000 });
    await expect(retryButton).toHaveCount(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.keyboard.press('Escape');
  });
});
