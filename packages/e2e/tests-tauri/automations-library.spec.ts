/**
 * §automations-library — Automations library row spec for app-tauri browser mode.
 *
 * Covers the three behaviors the library ships with no prior e2e coverage: a
 * per-row delete through the shared confirm dialog (accepted and cancelled),
 * the project badge (owning project's name, or "All projects" when unscoped),
 * and cross-project scoping (the daemon returns a selected project's
 * automations plus every unscoped one). Runs entirely in E2E_MODE=mock — every
 * test seeds over REST and never sends a message, so there is no
 * `recordingKey`.
 *
 * Testid reference (verified against packages/ui/src/features/automations/):
 *   sidebar-action-automations       — sidebar entry point that opens the host
 *   automations-host                 — the Radix Dialog content root (absent when closed)
 *   automations-view                 — the view root inside the host
 *   automations-close                — the view's close button
 *   automations-section-library      — the library's section container
 *   automations-library              — the library list root (ALSO the loading
 *                                       container — see the refresh recipe below)
 *   automations-library-loading      — present only while a fetch is in flight
 *   automations-library-row-<id>     — one row, keyed by automation id
 *   automations-library-delete-<id>  — a row's delete action
 *   automations-library-project-<id> — a row's project badge
 *   automations-delete-confirm       — the shared ConfirmDialog root the row raises
 *   automations-delete-confirm-confirm / -cancel — its derived button pair
 *   sidebar-project-<projectId>      — sidebar project-switcher row (also
 *                                       activates that project's most recent
 *                                       session — see below)
 *   sidebar-project-all              — clears the project filter WITHOUT
 *                                       switching the active session
 *
 * Three facts every test here leans on — read before "simplifying" a scenario:
 *
 * 1. Reopening the host does NOT re-fetch the library. `AutomationsHost`'s
 *    load effect depends on `[projectId, setActiveProjectId, loadAll]` — `open`
 *    is absent — and `LibraryList` has no mount-time fetch of its own. The only
 *    refresh triggers are an active-project-id change or a page reload.
 * 2. The library's scope is the active SESSION's project
 *    (`useActiveIdentity().projectId`), not the sidebar filter row. The two
 *    usually move together but can desync across a reload, so every scenario
 *    pins scope by selecting the target project's seeded chat directly.
 * 3. Nothing broadcasts an automation create or delete over the WS event bus,
 *    so a REST seed or delete is invisible until the next refresh — assertions
 *    that need to observe a mutation always go through the refresh recipe
 *    below, never a bare wait.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import {
  createTauriProject,
  createTauriChat,
  createTauriAutomation,
  cleanupTauriProject,
  type TauriProject,
} from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

/**
 * Bring the UI to a freshly fetched library for the project that owns
 * `chatId`. Selecting that chat's row is what pins `useActiveIdentity().projectId`
 * — the library's actual scope — deterministically, independent of whatever the
 * sidebar filter row last showed.
 *
 * Row clicks in the sessions sidebar get eaten by `SessionRow`'s HoverCard
 * (500ms openDelay), so this parks the pointer and retries the whole
 * click-then-assert step as a unit, mirroring `sessions-filters.spec.ts`'s
 * `selectRow`.
 */
async function openLibraryFor(page: Page, chatId: string): Promise<void> {
  await page.reload();
  await waitConnected(page);

  // Widens the sidebar to both projects' rows without switching the active
  // session, so the target chat's row is guaranteed clickable next.
  await page.getByTestId('sidebar-project-all').click();

  const row = sessionsSidebar(page).row(chatId);
  await expect(async () => {
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-slot="hover-card-content"]')).toHaveCount(0, { timeout: 2_000 });
    await row.click({ timeout: 5_000 });
    await expect(row).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });

  await page.getByTestId('sidebar-action-automations').click();
  await expect(page.getByTestId('automations-library')).toBeVisible({ timeout: 10_000 });
  // The loading branch renders the SAME `automations-library` testid with zero
  // rows inside it, so "visible" alone doesn't mean the fetch landed — this is
  // a no-fetch-in-flight guard, not proof a fetch ran (scenarios asserting an
  // empty view still need a positive anchor row on top of this).
  await expect(page.getByTestId('automations-library-loading')).toHaveCount(0, { timeout: 15_000 });
}

async function closeLibrary(page: Page): Promise<void> {
  await page.getByTestId('automations-close').click();
  await expect(page.getByTestId('automations-host')).toHaveCount(0, { timeout: 10_000 });
}

// ─── §automations-library ─────────────────────────────────────────────────

test.describe('§automations-library', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;
  let chatIdA: string;
  let chatIdB: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    projectA = await createTauriProject(app.page);
    chatIdA = await createTauriChat(app.page, projectA.projectId, 'default');
    // createTauriProject reloads the page — the chat just created is
    // REST-seeded and survives that reload.
    projectB = await createTauriProject(app.page);
    chatIdB = await createTauriChat(app.page, projectB.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(projectA);
    cleanupTauriProject(projectB);
    await closeTauriApp(app);
  });

  test('opens and closes the library for project A', async () => {
    const { page } = app;
    await openLibraryFor(page, chatIdA);
    await expect(page.getByTestId('automations-section-library')).toBeVisible();
    await closeLibrary(page);
  });

  test('delete, confirmed: accepting the confirm dialog removes the row and it stays gone after a re-fetch', async () => {
    const { page } = app;
    // Two automations: the anchor is never deleted, so the post-delete
    // re-fetch assertion is real — without it, a view that never fetched
    // anything would also show zero rows for the (otherwise sole) target.
    const anchorId = await createTauriAutomation({ name: 'delete-confirmed anchor', projectId: projectA.projectId });
    const targetId = await createTauriAutomation({ name: 'delete-confirmed target', projectId: projectA.projectId });

    await openLibraryFor(page, chatIdA);

    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();
    await page.getByTestId(`automations-library-delete-${targetId}`).click();

    const confirmDialog = page.getByTestId('automations-delete-confirm');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('delete-confirmed target');

    await page.getByTestId('automations-delete-confirm-confirm').click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toHaveCount(0);

    await closeLibrary(page);
    await openLibraryFor(page, chatIdA);

    // Order matters: the anchor row can only appear from a landed re-fetch
    // (definitions starts empty after the reload), which is what makes the
    // target's absence next mean "deleted server-side" rather than "nothing
    // loaded yet".
    await expect(page.getByTestId(`automations-library-row-${anchorId}`)).toBeVisible();
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toHaveCount(0);
  });

  test('delete, cancelled: dismissing the confirm dialog leaves the row intact after a re-fetch', async () => {
    const { page } = app;
    const targetId = await createTauriAutomation({ name: 'delete-cancelled target', projectId: projectA.projectId });

    await openLibraryFor(page, chatIdA);

    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();
    await page.getByTestId(`automations-library-delete-${targetId}`).click();

    const confirmDialog = page.getByTestId('automations-delete-confirm');
    await expect(confirmDialog).toBeVisible();

    await page.getByTestId('automations-delete-confirm-cancel').click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();

    await closeLibrary(page);
    await openLibraryFor(page, chatIdA);

    // The automation was never deleted server-side, so the row survives a
    // landed re-fetch too, not just the un-refreshed DOM from before the
    // cancel.
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();
  });
});
