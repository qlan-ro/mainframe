/**
 * §session-tabs — chrome-style session tabs in the MainToolbar
 * (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * UI-only, no recordings: tabs are pure chrome over the thread list. One
 * project + two chats; every activation path goes through the one membership
 * seam (`useSessionTabsSync`), which is EDITOR-STYLE: an activation fills the
 * single PREVIEW slot, replacing whatever was previewed, and only pinning
 * (double-click or the pill's pin button) promotes a tab into the pinned set
 * that survives the next activation. So opening two sessions in a row leaves
 * ONE tab, not two — the contract pinned below, taken from the store's own
 * unit tests (`session-tabs/__tests__/use-session-tabs-sync.preview.test.tsx`).
 *
 * Testid reference (verified against packages/ui/src/features/session-tabs/):
 *   session-tabs             — the strip root (inside main-toolbar)
 *   session-tab-<threadId>   — a tab pill (role=tab, aria-selected, data-preview);
 *                              threadId is the chat id for daemon-created chats
 *   session-tab-close-<id>   — a tab's hover close button
 *   session-tab-pin-<id>     — a preview tab's hover pin ("Keep open")
 *   session-tabs-new         — the "+" button (the one-click new-session flow)
 *   sessions-row + data-chat-id — a sidebar session row (helpers/tauri/testids)
 *   sessions-welcome / welcome-project — the draft's welcome screen and its
 *                              project picker, which own the project choice now
 *                              (the anchored "NEW SESSION IN…" popover is gone)
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

  // `createTauriChat` activates each chat it creates, so chatA was previewed
  // and chatB then REPLACED it in the same slot — the strip holds one tab.
  test('activating a session fills the single preview slot; the next activation replaces it', async () => {
    const { page } = app;
    await expect(page.locator(TAB_PILLS)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('data-preview', 'true');
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveCount(0);
  });

  test('pinning the preview keeps it; the next activation opens its own preview', async () => {
    const { page } = app;
    await page.getByTestId(`session-tab-pin-${chatB}`).click({ force: true });
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('data-preview', 'false', {
      timeout: 10_000,
    });

    await sessionsSidebar(page).row(chatA).click();

    await expect(page.locator(TAB_PILLS)).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('data-preview', 'true');
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking a tab switches the active session', async () => {
    const { page } = app;
    await page.getByTestId(`session-tab-${chatB}`).click();
    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'true', {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'false');
  });

  test('closing the active tab removes it and activates the neighbor', async () => {
    const { page } = app;
    // chatB (pinned, first in display order) is active from the previous test;
    // closing it should land on its only neighbor, the chatA preview.
    await page.getByTestId(`session-tab-close-${chatB}`).click({ force: true });

    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('aria-selected', 'true');
  });

  test('a closed session reopens as a tab when activated from the sidebar', async () => {
    const { page } = app;
    // Pin what's on screen first — otherwise reopening chatB would just replace
    // the chatA preview and the strip would stay at one tab.
    await page.getByTestId(`session-tab-pin-${chatA}`).click({ force: true });
    await expect(page.getByTestId(`session-tab-${chatA}`)).toHaveAttribute('data-preview', 'false', {
      timeout: 10_000,
    });

    await sessionsSidebar(page).row(chatB).click();

    await expect(page.getByTestId(`session-tab-${chatB}`)).toHaveAttribute('aria-selected', 'true', {
      timeout: 10_000,
    });
    await expect(page.locator(TAB_PILLS)).toHaveCount(2);
  });

  test('the "+" button starts the new-session flow', async () => {
    const { page } = app;
    await page.getByTestId('session-tabs-new').click();
    // One click, no anchored picker: the projectless draft opens straight away
    // and its welcome screen owns the project choice.
    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('welcome-project')).toBeVisible();
  });
});
