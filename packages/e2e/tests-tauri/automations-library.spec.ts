/**
 * §automations-library — automations sidebar + details row spec for app-tauri
 * browser mode.
 *
 * 2026-10 redesign retired the body-wide library: the sidebar list is the
 * only "browse automations" surface, and a selected automation's actions
 * (including delete and its project badge) live in the Details header
 * instead of a library row. This spec, previously `automations-library-*`
 * against `library/LibraryRow`, is retargeted to the sidebar rows (for
 * presence/scoping) and the Details header (for delete/badge) — same three
 * behaviors, same E2E_MODE=mock REST-seeding approach (nothing broadcasts an
 * automation create/delete over the WS event bus, so a reload is still the
 * only way to observe a mutation).
 *
 * Testid reference (verified against packages/ui/src/features/automations/):
 *   shell-rail-chats / -automations     — nav rail view switches (NavRail.tsx), D1/D5/D7
 *   automations-sidebar-row-<id>        — one sidebar row, keyed by automation id; its
 *                                          PRESENCE/ABSENCE after a scope change is the
 *                                          cross-project-scoping assertion now
 *   automations-view                    — the body root
 *   automations-details                 — Details' body root, once a row is clicked
 *   automations-details-project         — Details header's project chip (scoped name, or
 *                                          "All projects" for an unscoped automation)
 *   automations-details-delete          — Details header's delete action
 *   automations-delete-confirm          — the shared ConfirmDialog root the delete raises
 *   automations-delete-confirm-confirm / -cancel — its derived button pair
 *   sessions-scope-avatar-<id>          — a project's avatar in the shared scope strip
 *                                          (ScopeStrip.tsx via SidebarScopeStrip, D7); `aria-pressed`
 *                                          is "true"/"false". ⌥-click solos the scope to that one
 *                                          project — never switches the active session.
 *
 * Two facts every test here leans on — read before "simplifying" a scenario:
 *
 * 1. The sidebar list's scope is D7's shared session scope (`useSessionFilters` →
 *    `ScopeStrip`/`SidebarScopeStrip`), NOT the active session's project — every
 *    scenario pins scope by ⌥-clicking the target project's avatar directly
 *    (`soloScope` below), independent of which chat (if any) is active.
 * 2. Nothing broadcasts an automation create or delete over the WS event bus, so a
 *    REST seed or delete is invisible until the next refresh — every scenario reloads
 *    after a REST mutation before asserting on it, never a bare wait.
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

/** Reload and land on the Automations rail view, scoped to `projectId`. */
async function openAutomationsFor(page: Page, projectId: string): Promise<void> {
  await page.reload();
  await waitConnected(page);

  // The scope strip's avatars render under Chats too (SidebarScopeStrip is
  // shared, D7), but Chats is the deterministic place to touch it before
  // switching views — the previous pass may have left the view on Automations
  // (the view persists, ui-prefs v8 `sidebarView`).
  const chatsRail = page.getByTestId('shell-rail-chats');
  await chatsRail.click();
  await expect(chatsRail).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

  await soloScope(page, projectId);

  await page.getByTestId('shell-rail-automations').click();
  await expect(page.getByTestId('automations-view')).toBeVisible({ timeout: 10_000 });
}

// ─── §automations-library ─────────────────────────────────────────────────

test.describe('§automations-library', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    projectA = await createTauriProject(app.page);
    // A seeded chat per project so neither is a boot dead-end; the sidebar's
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

  test('delete, confirmed: accepting the confirm dialog removes the row and it stays gone after a reload', async () => {
    const { page } = app;
    // Two automations: the anchor is never deleted, so the post-delete
    // reload assertion is real — without it, a view that never loaded
    // anything would also show zero rows for the (otherwise sole) target.
    const anchorId = await createTauriAutomation({ name: 'delete-confirmed anchor', projectId: projectA.projectId });
    const targetId = await createTauriAutomation({ name: 'delete-confirmed target', projectId: projectA.projectId });

    await openAutomationsFor(page, projectA.projectId);

    await expect(page.getByTestId(`automations-sidebar-row-${targetId}`)).toBeVisible();
    await page.getByTestId(`automations-sidebar-row-${targetId}`).click();
    await expect(page.getByTestId('automations-details')).toBeVisible();

    await page.getByTestId('automations-details-delete').click();
    const confirmDialog = page.getByTestId('automations-delete-confirm');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('delete-confirmed target');

    await page.getByTestId('automations-delete-confirm-confirm').click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`automations-sidebar-row-${targetId}`)).toHaveCount(0);

    await openAutomationsFor(page, projectA.projectId);

    // Order matters: the anchor row can only appear from a landed reload
    // (the list starts empty after a fresh page load), which is what makes
    // the target's absence next mean "deleted server-side" rather than
    // "nothing loaded yet".
    await expect(page.getByTestId(`automations-sidebar-row-${anchorId}`)).toBeVisible();
    await expect(page.getByTestId(`automations-sidebar-row-${targetId}`)).toHaveCount(0);
  });

  test('delete, cancelled: dismissing the confirm dialog leaves the row intact after a reload', async () => {
    const { page } = app;
    const targetId = await createTauriAutomation({ name: 'delete-cancelled target', projectId: projectA.projectId });

    await openAutomationsFor(page, projectA.projectId);

    await page.getByTestId(`automations-sidebar-row-${targetId}`).click();
    await expect(page.getByTestId('automations-details')).toBeVisible();

    await page.getByTestId('automations-details-delete').click();
    const confirmDialog = page.getByTestId('automations-delete-confirm');
    await expect(confirmDialog).toBeVisible();

    await page.getByTestId('automations-delete-confirm-cancel').click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(page.getByTestId('automations-details')).toBeVisible();

    await openAutomationsFor(page, projectA.projectId);

    // The automation was never deleted server-side, so the row survives a
    // landed reload too, not just the un-refreshed DOM from before the cancel.
    await expect(page.getByTestId(`automations-sidebar-row-${targetId}`)).toBeVisible();
  });

  test('badge, scoped: a project-scoped automation shows its project name in Details', async () => {
    const { page } = app;
    const targetId = await createTauriAutomation({ name: 'badge scoped target', projectId: projectA.projectId });

    await openAutomationsFor(page, projectA.projectId);
    await page.getByTestId(`automations-sidebar-row-${targetId}`).click();

    await expect(page.getByTestId('automations-details-project')).toHaveText(path.basename(projectA.projectPath));
  });

  test('badge, unscoped: an automation with no project scope reads "All projects" in Details', async () => {
    const { page } = app;
    const targetId = await createTauriAutomation({ name: 'badge unscoped target' });

    await openAutomationsFor(page, projectA.projectId);
    await page.getByTestId(`automations-sidebar-row-${targetId}`).click();

    await expect(page.getByTestId('automations-details-project')).toHaveText('All projects');
  });

  test("scoping, negative: an automation scoped to project A is absent from project B's sidebar", async () => {
    const { page } = app;
    const scopedId = await createTauriAutomation({ name: 'scoping negative scoped', projectId: projectA.projectId });
    const unscopedId = await createTauriAutomation({ name: 'scoping negative unscoped' });

    await openAutomationsFor(page, projectB.projectId);

    // Guard against an empty-list false pass: the sidebar must actually be
    // showing rows (the unscoped automation) for the scoped row's absence to
    // mean "filtered out" rather than "nothing loaded".
    await expect(page.getByTestId(`automations-sidebar-row-${unscopedId}`)).toBeVisible();
    await expect(page.getByTestId(`automations-sidebar-row-${scopedId}`)).toHaveCount(0);
  });

  test("scoping, positive: an unscoped automation is visible from both projects' sidebars", async () => {
    const { page } = app;
    const unscopedId = await createTauriAutomation({ name: 'scoping positive unscoped' });

    await openAutomationsFor(page, projectB.projectId);
    await expect(page.getByTestId(`automations-sidebar-row-${unscopedId}`)).toBeVisible();

    await openAutomationsFor(page, projectA.projectId);
    await expect(page.getByTestId(`automations-sidebar-row-${unscopedId}`)).toBeVisible();
  });
});
