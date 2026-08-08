/**
 * §sidebar-chrome — the sidebar's header actions, footer status, collapse
 * affordances, and the inspector's bottom-panel resize.
 *
 * Scope: docs/plans/2026-07-03-tauri-e2e-test-plan.md spec #5 (Cluster A).
 * UI-only — none of these scenarios need an agent-turn recording.
 *
 * The whole left panel is the v2 sidebar since the 2026-08 shell integration
 * (`app/AppShell.tsx` mounts `@v2/features/sessions/SessionSidebar` inside a
 * shadcn `SidebarProvider`), so `layout/SidebarHeader.tsx` and `SidebarShell.tsx`
 * are gone with their testids. What replaced them:
 *
 * Testid reference (verified against source):
 *   sidebar-settings           — v2/features/sessions/SessionSidebar.tsx HeaderActions (was
 *                                `sidebar-settings-button`)
 *   sidebar-tasks              — same HeaderActions (dispatches `mf:open-tasks`; was
 *                                `sidebar-tasks-button`)
 *   sidebar-workflows          — same HeaderActions, opens the Automations v2 host via
 *                                `useAutomationsNav().openHost()` (was `sidebar-workflows-button`)
 *   sidebar-workflows-pending  — the pending-interaction dot on that button
 *   settings-dialog / settings-dialog-close — features/settings/SettingsDialog.tsx
 *   tasks-board-modal / tasks-board-close   — features/tasks/TasksBoard.tsx (mounted by TasksModalHost)
 *   automations-host / automations-view / automations-close — features/automations/AutomationsHost.tsx +
 *                                AutomationsView.tsx (fullview panel; v1's `workflows-modal` was deleted)
 *   [data-slot="sidebar"]      — the panel root (v2/components/ui/sidebar/sidebar.tsx). There is no
 *                                `sessions-sidebar` testid and no unmount: `collapsible="offcanvas"`
 *                                animates the width to 0 and publishes
 *                                `data-state="expanded"|"collapsed"`. shadcn primitives stay
 *                                passthrough, so the slot attribute is the contract here.
 *   [data-slot="sidebar-rail"] — the panel's right edge (aria-label "Resize sidebar"): drag to
 *                                resize, click to collapse. This replaced `sidebar-hide-button`,
 *                                which the v2 header does not carry — the other collapse
 *                                affordance is ⌘B (SidebarProvider owns the shortcut).
 *   show-sidebar-button        — layout/MainToolbar.tsx (rendered only when `!sidebarVisible`)
 *   daemon-footer-trigger      — v2/features/daemon/DaemonSwitcher.tsx trigger; its ConnDot carries
 *                                aria-label="Connected" (v2/features/daemon/daemon-status.tsx)
 *   main-toolbar-files         — layout/MainToolbar.tsx (toggle-workspace-files intent)
 *
 * The bottom Context/Skills/Agents panel and its drag-resize handle
 * (`sidebar-bottom-panel` / `sidebar-bottom-resize`) were deleted in the
 * right-sidebar revamp (T5.4) along with `features/context-panel/`. There is no
 * successor to resize: the session panel is a fixed-width card that switches to a
 * rail on width, which session-panel.spec.ts covers. The two resize tests went
 * with the surface rather than being retargeted.
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

test.describe('§sidebar-chrome', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // One chat so an active session exists — TasksModalHost renders null (and the
    // tasks button no-ops) when useActiveIdentity() has no projectId.
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('settings button opens the settings dialog', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('settings-dialog-close').click();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 5_000 });
  });

  test('tasks button opens the tasks modal', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-tasks').click();
    await expect(page.getByTestId('tasks-board-modal')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('tasks-board-close').click();
    await expect(page.getByTestId('tasks-board-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  test('workflows button opens the automations panel', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-workflows').click();
    await expect(page.getByTestId('automations-host')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('automations-close').click();
    await expect(page.getByTestId('automations-host')).toHaveCount(0, { timeout: 5_000 });
  });

  // TODO(recording): the pending dot (`sidebar-workflows-pending` in SessionSidebar.tsx
  // HeaderActions, `pending > 0` from
  // selectPendingInteractionCount(useAutomationsStore)) is populated by the automations WS
  // event stream when a run pauses on a needs-you interaction — there's no REST seed for that
  // state. Needs an automation fixture with a paused run; unskip once one exists.
  test.skip('workflows button shows a pending dot when a run needs input', async () => {});

  test('footer shows the daemon connected status', async () => {
    const { page } = app;
    // ConnDot renders <span aria-label="Connected"> for DaemonStatus 'connected'
    // (v2/features/daemon/daemon-status.tsx DAEMON_STATUS.connected.label) — the dot itself has
    // no dedicated testid, so we scope the aria-label lookup to the trigger's own testid.
    await expect(page.getByTestId('daemon-footer-trigger').locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  // The three per-status footer count chips (idle / working / waiting) are GONE, not
  // flagged off: `layout/SidebarFooter.tsx` and its SHOW_SESSION_COUNTS flag were deleted
  // with the v2 shell integration, and the v2 footer holds tags, quota and the daemon
  // switcher only. `useSessionCounts` survives but now feeds the new-session picker's
  // per-project labels (SessionsNewButton.tsx). Per-session working/waiting state is
  // covered on the row's status dot in sessions-rows.spec.ts.

  // The v2 header carries no hide button (SessionSidebar.tsx HeaderActions is
  // workflows/tasks/settings only). Collapsing is the panel's own edge — clicking
  // `sidebar-rail` short of the drag slop toggles it (sidebar.tsx SidebarRail) —
  // and the panel COLLAPSES rather than unmounting, so the assertion moved from
  // presence to `data-state`.
  test('clicking the sidebar rail collapses the panel and show-sidebar-button restores it', async () => {
    const { page } = app;
    const panel = page.locator('[data-slot="sidebar"]');
    await expect(panel).toHaveAttribute('data-state', 'expanded');
    await expect(page.getByTestId('show-sidebar-button')).toHaveCount(0);

    await page.locator('[data-slot="sidebar-rail"]').click();
    await expect(panel).toHaveAttribute('data-state', 'collapsed', { timeout: 5_000 });

    const showButton = page.getByTestId('show-sidebar-button');
    await expect(showButton).toBeVisible({ timeout: 5_000 });
    await showButton.click();

    await expect(panel).toHaveAttribute('data-state', 'expanded', { timeout: 5_000 });
    await expect(page.getByTestId('show-sidebar-button')).toHaveCount(0, { timeout: 5_000 });
  });

  test('⌘B toggles the panel from anywhere', async () => {
    const { page } = app;
    const panel = page.locator('[data-slot="sidebar"]');
    await expect(panel).toHaveAttribute('data-state', 'expanded');

    await page.keyboard.press('ControlOrMeta+b');
    await expect(panel).toHaveAttribute('data-state', 'collapsed', { timeout: 5_000 });

    await page.keyboard.press('ControlOrMeta+b');
    await expect(panel).toHaveAttribute('data-state', 'expanded', { timeout: 5_000 });
  });
});
