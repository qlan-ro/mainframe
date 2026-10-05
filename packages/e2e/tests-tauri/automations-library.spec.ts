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
 *   shell-rail-chats / -automations  — nav rail view switches (NavRail.tsx), D1/D5/D7: the
 *                                       rail switches BOTH the sidebar (AutomationsSidebarList)
 *                                       AND the body (AutomationsSurface/AutomationsView,
 *                                       the SidebarInset content) to Automations. The view is
 *                                       persisted (ui-prefs v8 `sidebarView`), so after a reload
 *                                       the sidebar/body may come back on Automations — switch
 *                                       to Chats before touching the scope strip.
 *   automations-sidebar-open-library — the list header's "Open the library" button: shows
 *                                       Automations AND clears any open sub-view, landing on
 *                                       the bare LIBRARY. (⌘⇧A does the same but is `dev: true`
 *                                       and filtered out of the built app the e2e harness runs
 *                                       — never rely on it.)
 *   automations-view                 — the view root (now body content, not a dialog —
 *                                       `automations-host` is gone, there is no Radix Dialog)
 *   automations-close                — "back to library"; renders ONLY while a sub-view
 *                                       (editor/run/describe/details) owns the body
 *   automations-section-library      — the library's section container
 *   automations-library              — the library list root (ALSO the loading
 *                                       container — see the refresh recipe below)
 *   automations-library-loading      — present only while a fetch is in flight
 *   automations-library-row-<id>     — one row, keyed by automation id
 *   automations-library-delete-<id>  — a row's delete action
 *   automations-library-project-<id> — a row's project badge
 *   automations-delete-confirm       — the shared ConfirmDialog root the row raises
 *   automations-delete-confirm-confirm / -cancel — its derived button pair
 *   sessions-scope-avatar-<id>       — a project's avatar in the shared scope strip
 *                                       (ScopeStrip.tsx via SidebarScopeStrip, D7 — now the ONE
 *                                       project-scope control for Chats/Tasks/Automations/
 *                                       Setup Advisor, rendered in the Automations sidebar
 *                                       header too, not just under Chats); `aria-pressed` is
 *                                       "true"/"false" (`data-state` is the tooltip's).
 *                                       ⌥-click solos the scope to that one project — never
 *                                       switches the active session.
 *   sessions-scope-label             — "All projects" (empty scope) or "N project(s)"
 *
 * Three facts every test here leans on — read before "simplifying" a scenario:
 *
 * 1. Reopening the library does NOT re-fetch by itself — `useAutomationsLibraryView`
 *    (LibraryList) only READS; `AutomationsSurface`'s `useScopedAutomationsLibrary`
 *    is the one mount that loads, keyed on the resolved scope. The only refresh
 *    triggers are a scope change or a page reload.
 * 2. The library's scope is D7's shared session scope (`useSessionFilters` →
 *    `ScopeStrip`/`SidebarScopeStrip`) now, NOT the active session's project —
 *    every scenario pins scope by ⌥-clicking the target project's avatar
 *    directly (`soloScope` below), independent of which chat (if any) is active.
 * 3. Nothing broadcasts an automation create or delete over the WS event bus,
 *    so a REST seed or delete is invisible until the next refresh — assertions
 *    that need to observe a mutation always go through the refresh recipe
 *    below, never a bare wait.
 */

import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import {
  createTauriProject,
  createTauriChat,
  createTauriAutomation,
  cleanupTauriProject,
  type TauriProject,
} from '../helpers/tauri/setup.js';
import { waitConnected } from '../helpers/tauri/wait.js';

/**
 * D7: solo the shared session scope to exactly `projectId` — the ONE project
 * scope control now, shared by Chats/Tasks/Automations/Setup Advisor. ⌥-click
 * REPLACES whatever the scope held, so this is also how a later call switches
 * from project A to B — no separate "clear" step needed.
 */
async function soloScope(page: Page, projectId: string): Promise<void> {
  const avatar = page.getByTestId(`sessions-scope-avatar-${projectId}`);
  await avatar.click({ modifiers: ['Alt'], timeout: 5_000 });
  await expect(avatar).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
}

/** Bring the UI to a freshly fetched library scoped to `projectId`. */
async function openLibraryFor(page: Page, projectId: string): Promise<void> {
  await page.reload();
  await waitConnected(page);

  // The previous pass left the sidebar/body on the Automations view, and that
  // view is persisted — the scope strip's avatars render under Chats too
  // (SidebarScopeStrip is shared, D7), but Chats is the deterministic place to
  // touch it before switching views.
  const chatsRail = page.getByTestId('shell-rail-chats');
  await chatsRail.click();
  await expect(chatsRail).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

  await soloScope(page, projectId);

  // Rows and New land on Details / the editor; only the list header's
  // "Open the library" button returns the body to the bare library.
  await page.getByTestId('shell-rail-automations').click();
  await page.getByTestId('automations-sidebar-open-library').click({ timeout: 10_000 });
  await expect(page.getByTestId('automations-library')).toBeVisible({ timeout: 10_000 });
  // The loading branch renders the SAME `automations-library` testid with zero
  // rows inside it, so "visible" alone doesn't mean the fetch landed — this is
  // a no-fetch-in-flight guard, not proof a fetch ran (scenarios asserting an
  // empty view still need a positive anchor row on top of this).
  await expect(page.getByTestId('automations-library-loading')).toHaveCount(0, { timeout: 15_000 });
}

// ─── §automations-library ─────────────────────────────────────────────────

test.describe('§automations-library', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    projectA = await createTauriProject(app.page);
    // A seeded chat per project so neither is a boot dead-end; the library's
    // scope comes from the shared ScopeStrip now (D7), not from either chat.
    await createTauriChat(app.page, projectA.projectId, 'default');
    // createTauriProject reloads the page — the chat just created is
    // REST-seeded and survives that reload.
    projectB = await createTauriProject(app.page);
    await createTauriChat(app.page, projectB.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(projectA);
    cleanupTauriProject(projectB);
    await closeTauriApp(app);
  });

  test('delete, confirmed: accepting the confirm dialog removes the row and it stays gone after a re-fetch', async () => {
    const { page } = app;
    // Two automations: the anchor is never deleted, so the post-delete
    // re-fetch assertion is real — without it, a view that never fetched
    // anything would also show zero rows for the (otherwise sole) target.
    const anchorId = await createTauriAutomation({ name: 'delete-confirmed anchor', projectId: projectA.projectId });
    const targetId = await createTauriAutomation({ name: 'delete-confirmed target', projectId: projectA.projectId });

    await openLibraryFor(page, projectA.projectId);

    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();
    await page.getByTestId(`automations-library-delete-${targetId}`).click();

    const confirmDialog = page.getByTestId('automations-delete-confirm');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('delete-confirmed target');

    await page.getByTestId('automations-delete-confirm-confirm').click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toHaveCount(0);

    await openLibraryFor(page, projectA.projectId);

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

    await openLibraryFor(page, projectA.projectId);

    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();
    await page.getByTestId(`automations-library-delete-${targetId}`).click();

    const confirmDialog = page.getByTestId('automations-delete-confirm');
    await expect(confirmDialog).toBeVisible();

    await page.getByTestId('automations-delete-confirm-cancel').click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();

    await openLibraryFor(page, projectA.projectId);

    // The automation was never deleted server-side, so the row survives a
    // landed re-fetch too, not just the un-refreshed DOM from before the
    // cancel.
    await expect(page.getByTestId(`automations-library-row-${targetId}`)).toBeVisible();
  });

  test('badge, scoped: a project-scoped automation shows its project name', async () => {
    const { page } = app;
    const targetId = await createTauriAutomation({ name: 'badge scoped target', projectId: projectA.projectId });

    await openLibraryFor(page, projectA.projectId);

    await expect(page.getByTestId(`automations-library-project-${targetId}`)).toHaveText(
      path.basename(projectA.projectPath),
    );
  });

  test('badge, unscoped: an automation with no project scope reads "All projects"', async () => {
    const { page } = app;
    const targetId = await createTauriAutomation({ name: 'badge unscoped target' });

    await openLibraryFor(page, projectA.projectId);

    await expect(page.getByTestId(`automations-library-project-${targetId}`)).toHaveText('All projects');
  });

  test('scoping, negative: an automation scoped to project A is absent from project B', async () => {
    const { page } = app;
    const scopedId = await createTauriAutomation({ name: 'scoping negative scoped', projectId: projectA.projectId });
    const unscopedId = await createTauriAutomation({ name: 'scoping negative unscoped' });

    await openLibraryFor(page, projectB.projectId);

    // Guard against an empty-library false pass: the library must actually be
    // showing rows (the unscoped automation) for the scoped row's absence to
    // mean "filtered out" rather than "nothing loaded".
    await expect(page.getByTestId('automations-library')).toBeVisible();
    await expect(page.getByTestId(`automations-library-row-${unscopedId}`)).toBeVisible();
    await expect(page.getByTestId(`automations-library-row-${scopedId}`)).toHaveCount(0);
  });

  test('scoping, positive: an unscoped automation is visible from both projects', async () => {
    const { page } = app;
    const unscopedId = await createTauriAutomation({ name: 'scoping positive unscoped' });

    await openLibraryFor(page, projectB.projectId);
    await expect(page.getByTestId(`automations-library-row-${unscopedId}`)).toBeVisible();

    await openLibraryFor(page, projectA.projectId);
    await expect(page.getByTestId(`automations-library-row-${unscopedId}`)).toBeVisible();
  });
});
