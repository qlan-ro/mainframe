/**
 * §session-tabs — chrome-style session tabs in the MainToolbar
 * (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * UI-only, no recordings: tabs are pure chrome over the thread list. One
 * project + two chats; every activation path inserts a tab through the one
 * membership seam, so creating/clicking chats grows the strip.
 *
 * Testid reference (verified against packages/ui/src/features/session-tabs/):
 *   session-tabs             — the strip root (inside main-toolbar)
 *   session-tab-<threadId>   — a tab pill (role=tab, aria-selected); threadId is
 *                              the chat id for daemon-created chats
 *   session-tab-close-<id>   — a tab's hover close button
 *   session-tabs-new         — the "+" button (sidebar New flow)
 *   sessions-row + data-chat-id — a sidebar session row (helpers/tauri/testids)
 *   sessions-new-picker      — the shared "NEW SESSION IN…" project picker
 */
import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

const TAB_PILLS = '[data-testid^="session-tab-"][role="tab"]';

test.describe('§session-tabs', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatA: string;
  let chatB: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatA = await createTauriChat(app.page, project.projectId, 'default');
    chatB = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('each activated session becomes a tab; the last activated is selected', async () => {
    const { page } = app;
    await expect(page.locator(TAB_PILLS)).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking a tab switches the active session', async () => {
    const { page } = app;
    await page.getByTestId(`session-tab-${chatA}`).click();
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'true', {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'false');
  });

  test('closing the active tab removes it and activates the neighbor', async () => {
    const { page } = app;
    // chatA is active from the previous test; closing it should land on chatB.
    await page.getByTestId(`session-tab-close-${chatA}`).click({ force: true });

    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'true');
  });

  test('a closed session reopens as a tab when activated from the sidebar', async () => {
    const { page } = app;
    await sessionsSidebar(page).row(chatA).click();

    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'true', {
      timeout: 10_000,
    });
    await expect(page.locator(TAB_PILLS)).toHaveCount(2);
  });

  test('the "+" button starts the new-session flow', async () => {
    const { page } = app;
    await page.getByTestId('session-tabs-new').click();
    // No project pill is active in "All" view, so the flow opens the shared
    // project picker (same one the sidebar "+" opens) rather than a bare draft.
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
  });
});
