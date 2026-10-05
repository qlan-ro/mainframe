/**
 * §sidebar-chrome — the shell's ambient chrome: the nav rail's view switch and
 * bottom cluster (Settings/appearance/update), the sidebar's collapse
 * affordances, and the footer's daemon status.
 *
 * Scope: docs/plans/2026-07-03-tauri-e2e-test-plan.md spec #5 (Cluster A).
 * UI-only — none of these scenarios need an agent-turn recording.
 *
 * Retargeted whole for the shell redesign (docs/plans/2026-10-04-mainframe-redesign-adoption.md
 * D1/D3/D4/D5/D8): `layout/NavRail.tsx` now owns FIVE views — Chats, Tasks,
 * Automations, Setup Advisor, Settings — each a view button with the same
 * selected/`aria-pressed` treatment; picking one switches `sidebarView`
 * (`ui-prefs`), which the sidebar AND the body (the `SidebarInset`
 * `MainSurface` body-switch) both read. Tasks' board, the Automations
 * library and Settings all render straight in the body now — no modal, no
 * dialog, no "open board"/"open the host" indirection. The sidebar header's
 * old `HeaderActions` (`sidebar-settings`) and `SidebarActions` Kanban/
 * Automations rows are gone.
 *
 * D7: the project scope is the one shared `ScopeStrip` (sessions-scope-*
 * testids) in every project-scoped view's sidebar header — Chats, Tasks,
 * Automations, Setup Advisor. An empty scope shows a project pick list in
 * both the sidebar and the body for Tasks/Automations/Advisor; picking one
 * calls `soloFilterProject`, narrowing the SHARED scope (so every other
 * project-scoped view follows).
 *
 * Testid reference (verified against source):
 *   shell-rail                 — layout/NavRail.tsx root
 *   shell-rail-chats / -tasks / -automations / -advisor / -settings — the five
 *                                 view buttons (NavRailButton); `aria-pressed`
 *                                 mirrors the selected view
 *   shell-rail-automations-pending — the Automations button's pending-interaction dot
 *   shell-rail-update          — RailUpdateButton; renders NOTHING while idle (no update)
 *   shell-rail-appearance      — theme toggle (was `main-toolbar-theme`)
 *   sessions-scope-avatar-<id> — the shared ScopeStrip's per-project avatar (D7)
 *   tasks-board / tasks-surface-pick — features/tasks/TasksBoard.tsx / TasksSurface.tsx (body)
 *   automations-view / automations-section-library — features/automations/AutomationsView.tsx (body)
 *   settings-surface            — features/settings/SettingsSurface.tsx (body)
 *   [data-slot="sidebar"]      — the panel root (components/ui/sidebar/sidebar.tsx). There is no
 *                                `sessions-sidebar` testid and no unmount: `collapsible="offcanvas"`
 *                                animates the width to 0 and publishes
 *                                `data-state="expanded"|"collapsed"`. shadcn primitives stay
 *                                passthrough, so the slot attribute is the contract here.
 *   [data-slot="sidebar-rail"] — the panel's right edge (aria-label "Resize sidebar"): drag to
 *                                resize, click to collapse. This replaced `sidebar-hide-button`,
 *                                which no header carries — the other collapse
 *                                affordance is ⌘B (SidebarProvider owns the shortcut).
 *   show-sidebar-button        — layout/TitleBar.tsx (rendered only when the sidebar is collapsed)
 *   daemon-footer-trigger      — features/daemon/DaemonSwitcher.tsx trigger; its ConnDot carries
 *                                aria-label="Connected" (features/daemon/daemon-status.tsx)
 *
 * The bottom Context/Skills/Agents panel and its drag-resize handle
 * (`sidebar-bottom-panel` / `sidebar-bottom-resize`) were deleted in the
 * right-sidebar revamp (T5.4) along with `features/context-panel/`. There is no
 * successor to resize: the session panel is a fixed-width column that docks or
 * floats on width, which session-panel.spec.ts covers. The two resize tests went
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

  test('the Settings rail button shows the settings body; picking Chats leaves it', async () => {
    const { page } = app;
    await page.getByTestId('shell-rail-settings').click();
    await expect(page.getByTestId('settings-surface')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('shell-rail-chats').click();
    await expect(page.getByTestId('settings-surface')).toHaveCount(0, { timeout: 5_000 });
  });

  // D7: the project scope starts empty (no filter persisted), so Tasks/Automations/
  // Advisor land on a project pick list until the single project here is picked —
  // which narrows the SHARED scope, so every project-scoped view then agrees.
  test('the Tasks rail button switches the body to the Tasks surface, which shows the board once scoped', async () => {
    const { page } = app;
    const tasksRail = page.getByTestId('shell-rail-tasks');
    await tasksRail.click();
    await expect(tasksRail).toHaveAttribute('aria-pressed', 'true');

    const pick = page.getByTestId('tasks-surface-pick');
    if (await pick.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.getByTestId(`tasks-board-project-${project.projectId}`).click();
    }
    await expect(page.getByTestId('tasks-board')).toBeVisible({ timeout: 10_000 });

    // Back to Chats for the tests that follow.
    await page.getByTestId('shell-rail-chats').click();
  });

  test('the Automations rail button switches the body to the Automations surface, which shows the library', async () => {
    const { page } = app;
    const automationsRail = page.getByTestId('shell-rail-automations');
    await automationsRail.click();
    await expect(automationsRail).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('automations-view')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('automations-section-library')).toBeVisible({ timeout: 10_000 });

    // Back to Chats for the tests that follow.
    await page.getByTestId('shell-rail-chats').click();
  });

  test('the Setup Advisor rail button switches the body to the advisor surface', async () => {
    const { page } = app;
    const advisorRail = page.getByTestId('shell-rail-advisor');
    await advisorRail.click();
    await expect(advisorRail).toHaveAttribute('aria-pressed', 'true');

    const pick = page.getByTestId('advisor-surface-pick');
    if (await pick.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.getByTestId(`advisor-project-${project.projectId}`).click();
    }
    await expect(page.getByTestId('advisor-surface')).toBeVisible({ timeout: 10_000 });

    // Back to Chats for the tests that follow.
    await page.getByTestId('shell-rail-chats').click();
  });

  // TODO(recording): the rail's pending dot (`shell-rail-automations-pending` in
  // NavRail.tsx, `pending > 0` from selectPendingInteractionCount(useAutomationsStore))
  // is populated by the automations WS event stream when a run pauses on a
  // needs-you interaction — there's no REST seed for that state. Needs an
  // automation fixture with a paused run; unskip once one exists.
  test.skip('the Automations rail button shows a pending dot when a run needs input', async () => {});

  test('footer shows the daemon connected status', async () => {
    const { page } = app;
    // ConnDot renders <span aria-label="Connected"> for DaemonStatus 'connected'
    // (features/daemon/daemon-status.ts DAEMON_STATUS.connected.label) — the dot itself has
    // no dedicated testid, so we scope the aria-label lookup to the trigger's own testid.
    await expect(page.getByTestId('daemon-footer-trigger').locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  // The three per-status footer count chips (idle / working / waiting) are GONE, not
  // flagged off: `layout/SidebarFooter.tsx` and its SHOW_SESSION_COUNTS flag were deleted
  // with the v2 shell integration, and the footer holds quota rows and the daemon
  // switcher only now (QuotaFooter + DaemonSwitcher, AppSidebar.tsx). Per-session
  // working/waiting state is covered on the row's status dot in sessions-rows.spec.ts.

  // The sidebar header carries no hide button of its own (SessionSidebar.tsx's
  // header is search + collapse only now). Collapsing is the panel's own edge —
  // clicking `sidebar-rail` short of the drag slop toggles it (sidebar.tsx SidebarRail) —
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
