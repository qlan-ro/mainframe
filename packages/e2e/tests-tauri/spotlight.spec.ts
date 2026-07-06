/**
 * §spotlight — the ⌘O command palette for app-tauri browser mode.
 *
 * Spec: docs/plans/2026-07-03-tauri-e2e-test-plan.md #23 (Cluster D).
 * UI-only surface — no recording needed (no agent turn is ever sent).
 *
 * Source: packages/ui/src/features/palette/{SpotlightPalette,SpotlightRow,
 * palette-modes,palette-commands,use-spotlight-results}.
 *
 * Testid reference (verified against source):
 *   main-toolbar-search                     — toolbar button that opens the palette (click fallback)
 *   search-palette                          — dialog root
 *   search-palette-input                    — text field
 *   search-palette-mode-chip                — mode chip, only rendered for `>`/`@`/`#`
 *   search-palette-empty                    — "No matches" empty state
 *   search-palette-file-row-<path>          — default-mode file result
 *   search-palette-session-row-<remoteId>   — default-mode session result
 *   search-palette-command-row-<id>         — `>` command result (ids: review/settings/sidebar/inspector/files/run)
 *   search-palette-change-row-<path>        — `#` changed-file result
 *   files-tab-strip / diff-tab              — Files-surface targets a row selection opens
 *   sessions-row / sessions-new-button      — sidebar chrome used to observe command effects
 *
 * NOT found in source (pre-work punch-list item #6, not added here — out of scope
 * for this spec per the shared brief "never modify packages/ui"): a palette
 * loading-state testid. `use-spotlight-results.test.tsx`/`SpotlightPalette.test.tsx`
 * reference `search-palette-loading`, but no such testid exists in
 * `SpotlightPalette.tsx` — not asserted here.
 */

import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'fs';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';
import { waitConnected } from '../helpers/tauri/wait.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/** `renameChat` does not broadcast `chat.updated` — callers must reload to see it. */
async function renameChat(page: Page, chatId: string, title: string): Promise<void> {
  const res = await page.request.patch(`${DAEMON_BASE}/api/chats/${chatId}/title`, { data: { title } });
  if (!res.ok()) throw new Error(`renameChat failed (${res.status()}): ${await res.text()}`);
}

/** Open the palette via the deterministic toolbar-click path (⌘O covered separately). */
async function openPalette(page: Page): Promise<void> {
  await page.getByTestId('main-toolbar-search').click();
  await page.getByTestId('search-palette-input').waitFor({ timeout: 10_000 });
}

/** Close the palette if it is still open, so each test starts the next one clean. */
async function closePaletteIfOpen(page: Page): Promise<void> {
  const dialog = page.getByTestId('search-palette');
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  }
}

// ─── §23 Spotlight palette ─────────────────────────────────────────────────────

test.describe('§spotlight', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatAId: string;
  let chatBId: string;

  const UNIQUE_FILE = 'greeter.ts';
  const DIRTY_FILE = 'notes.md';
  const AMBIGUOUS_FILES = ['widget-alpha.ts', 'widget-beta.ts'];
  const CHAT_A_TITLE = 'Investigate login bug';
  const CHAT_B_TITLE = 'Ship changelog notes';

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);

    writeFileSync(`${project.projectPath}/${UNIQUE_FILE}`, 'export function greet() { return "hi"; }\n');
    for (const f of AMBIGUOUS_FILES) {
      writeFileSync(`${project.projectPath}/${f}`, `export const id = ${JSON.stringify(f)};\n`);
    }
    // Untracked (never committed) → shows up as an "added" change for `#` mode.
    writeFileSync(`${project.projectPath}/${DIRTY_FILE}`, '# notes\n');

    chatAId = await createTauriChat(app.page, project.projectId, 'default');
    chatBId = await createTauriChat(app.page, project.projectId, 'default');
    await renameChat(app.page, chatAId, CHAT_A_TITLE);
    await renameChat(app.page, chatBId, CHAT_B_TITLE);

    await app.page.reload();
    await waitConnected(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('main-toolbar-search button opens the palette', async () => {
    const { page } = app;
    await openPalette(page);
    await expect(page.getByTestId('search-palette')).toBeVisible();
    await expect(page.getByTestId('search-palette-input')).toBeFocused({ timeout: 5_000 });
    await closePaletteIfOpen(page);
  });

  test('⌘O opens the palette via the global hotkey', async () => {
    const { page } = app;
    await expect(page.getByTestId('search-palette')).toHaveCount(0);
    await page.keyboard.press('Meta+o');
    await expect(page.getByTestId('search-palette')).toBeVisible({ timeout: 5_000 });
    await closePaletteIfOpen(page);
  });

  test('Esc closes the palette', async () => {
    const { page } = app;
    await openPalette(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-palette')).toHaveCount(0, { timeout: 5_000 });
  });

  test('default mode with an empty query lists recent sessions', async () => {
    const { page } = app;
    await openPalette(page);
    await expect(page.getByTestId(`search-palette-session-row-${chatAId}`)).toContainText(CHAT_A_TITLE, {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`search-palette-session-row-${chatBId}`)).toContainText(CHAT_B_TITLE);
    await closePaletteIfOpen(page);
  });

  test('default mode query filters to a matching project file', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('greeter');
    const row = page.getByTestId(`search-palette-file-row-${UNIQUE_FILE}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(UNIQUE_FILE);
    await closePaletteIfOpen(page);
  });

  test('clicking a file row opens it in the Files surface', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('greeter');
    const row = page.getByTestId(`search-palette-file-row-${UNIQUE_FILE}`);
    await row.waitFor({ timeout: 10_000 });
    await row.click();

    await expect(page.getByTestId('search-palette')).toHaveCount(0, { timeout: 5_000 });
    const activeTab = page.getByTestId('files-tab-strip').locator('[role="tab"][aria-selected="true"]');
    await expect(activeTab).toContainText(UNIQUE_FILE, { timeout: 10_000 });
  });

  test('clicking a session row switches the active session', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('login bug');
    const row = page.getByTestId(`search-palette-session-row-${chatAId}`);
    await row.waitFor({ timeout: 10_000 });
    await row.click();

    await expect(page.getByTestId('search-palette')).toHaveCount(0, { timeout: 5_000 });
    const activeRow = page.locator(`[data-testid="sessions-row"][data-chat-id="${chatAId}"]`);
    await expect(activeRow).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
  });

  test('`>` command mode runs a command (Toggle Sidebar)', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('>sidebar');
    await expect(page.getByTestId('search-palette-mode-chip')).toHaveText('Commands');

    const commandRow = page.getByTestId('search-palette-command-row-sidebar');
    await expect(commandRow).toContainText('Toggle Sidebar');
    await commandRow.click();

    await expect(page.getByTestId('search-palette')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('sessions-new-button')).toBeHidden({ timeout: 5_000 });

    // Restore sidebar visibility for the remaining tests in this describe.
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('>sidebar');
    await page.getByTestId('search-palette-command-row-sidebar').click();
    await expect(page.getByTestId('sessions-new-button')).toBeVisible({ timeout: 5_000 });
  });

  test('`@` symbol mode switches the field to symbol search', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('@');
    await expect(page.getByTestId('search-palette-mode-chip')).toHaveText('Symbols');
    await expect(page.getByTestId('search-palette-input')).toHaveAttribute('placeholder', 'Go to symbol…');
    await closePaletteIfOpen(page);
  });

  // TODO(recording/lsp): `@` results come from use-workspace-symbols.ts, which calls
  // lspClientManager.ensureClient/getWorkspaceSymbols over the daemon's `/lsp/:projectId/:language`
  // WS proxy — a real typescript-language-server process. Whether that server starts
  // reliably (and fast enough) under the e2e daemon is unverified; per the shared brief,
  // documenting + skipping rather than asserting against a maybe-flaky LSP boot. See report.
  test('`@` symbol row opens the file at the symbol line (needs a running LSP server)', async () => {
    test.skip(true, 'TODO(app-tauri): needs a verified LSP server under the e2e daemon; see spotlight-report.md');
  });

  test('`#` changes mode row opens the file diff', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('#notes');
    await expect(page.getByTestId('search-palette-mode-chip')).toHaveText('Changes');

    const row = page.getByTestId(`search-palette-change-row-${DIRTY_FILE}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    await expect(page.getByTestId('search-palette')).toHaveCount(0, { timeout: 5_000 });
    const diffTab = page.getByTestId('diff-tab');
    await expect(diffTab).toBeVisible({ timeout: 10_000 });
    await expect(diffTab).toContainText(DIRTY_FILE);
  });

  test('↑↓ moves the active row and Enter opens the selected file', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('widget');

    const rows = page.locator('[data-testid^="search-palette-file-row-widget-"]');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toHaveAttribute('data-active', 'true');
    await expect(rows.nth(1)).toHaveAttribute('data-active', 'false');

    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('data-active', 'true');
    await expect(rows.nth(0)).toHaveAttribute('data-active', 'false');

    // State the confirm target from the row actually made active by the key
    // press — not from an assumed search-result order.
    const activeTestId = await rows.nth(1).getAttribute('data-testid');
    const expectedFile = activeTestId!.replace('search-palette-file-row-', '');

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('search-palette')).toHaveCount(0, { timeout: 5_000 });
    const activeTab = page.getByTestId('files-tab-strip').locator('[role="tab"][aria-selected="true"]');
    await expect(activeTab).toContainText(expectedFile, { timeout: 10_000 });
  });

  test('unmatched query shows the empty state', async () => {
    const { page } = app;
    await openPalette(page);
    await page.getByTestId('search-palette-input').fill('zzz-no-such-file-or-session-99');
    const empty = page.getByTestId('search-palette-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toContainText('No matches');
    await closePaletteIfOpen(page);
  });
});
