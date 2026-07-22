/**
 * §sidebar-chrome — SidebarHeader / SidebarFooter / bottom-panel resize chrome.
 *
 * Scope: docs/plans/2026-07-03-tauri-e2e-test-plan.md spec #5 (Cluster A).
 * UI-only — none of these scenarios need an agent-turn recording.
 *
 * Testid reference (verified against source):
 *   sidebar-settings-button    — layout/SidebarHeader.tsx SettingsBtn
 *   sidebar-tasks-button       — layout/SidebarHeader.tsx TasksBtn (dispatches `mf:open-tasks`)
 *   sidebar-workflows-button   — layout/SidebarHeader.tsx WorkflowsBtn (opens the Automations v2 host via
 *                                `useAutomationsNav().openHost()`; testid/copy kept from v1 — Automations v2
 *                                UI Phase 7 replaced the modal it opens, not the sidebar entry point)
 *   sidebar-hide-button        — layout/SidebarHeader.tsx HideSidebarBtn (toggles ui-prefs.sidebarVisible)
 *   settings-dialog / settings-dialog-close — features/settings/SettingsDialog.tsx
 *   tasks-board-modal / tasks-board-close   — features/tasks/TasksBoard.tsx (mounted by TasksModalHost)
 *   automations-host / automations-view / automations-close — features/automations/AutomationsHost.tsx +
 *                                AutomationsView.tsx (fullview panel; v1's `workflows-modal` was deleted)
 *   sessions-sidebar           — layout/SidebarShell.tsx root (unmounts entirely when hidden — AppShell.tsx
 *                                `{sidebarRendered && <SidebarShell/>}`)
 *   show-sidebar-button        — layout/MainToolbar.tsx (rendered only when `!sidebarRendered`)
 *   daemon-footer-trigger      — features/daemon/DaemonFooterStatus.tsx popover trigger
 *   main-toolbar-inspector     — layout/MainToolbar.tsx (toggles ui-prefs.inspectorVisible; the
 *                                Context/Skills/Agents bottom panel lives in the right InspectorPane
 *                                now, hidden by default — not in the left sidebar anymore)
 *   sidebar-bottom-resize      — features/context-panel/PanelResizeHandle.tsx (role=separator, pointer-drag)
 *   sidebar-bottom-panel       — features/context-panel/BottomPanel.tsx root <div style={{height}}>
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

/** Idempotent: the inspector starts hidden (ui-prefs default) and the toggle flips —
 *  only click when the pane isn't already mounted (retries re-enter with it open). */
async function openInspector(page: Page): Promise<void> {
  const pane = page.getByTestId('inspector-pane');
  if (!(await pane.isVisible().catch(() => false))) {
    await page.getByTestId('main-toolbar-inspector').click();
    await expect(pane).toBeVisible({ timeout: 5_000 });
  }
}

async function getBottomPanelHeight(page: Page): Promise<number> {
  const box = await page.getByTestId('sidebar-bottom-panel').boundingBox();
  if (!box) throw new Error('sidebar-chrome: bottom panel container not found');
  return box.height;
}

async function dragResizeHandle(page: Page, deltaY: number): Promise<void> {
  const handle = page.getByTestId('sidebar-bottom-resize');
  const box = await handle.boundingBox();
  if (!box) throw new Error('sidebar-chrome: sidebar-bottom-resize handle not found');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 10 });
  await page.mouse.up();
}

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
    await page.getByTestId('sidebar-settings-button').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('settings-dialog-close').click();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 5_000 });
  });

  test('tasks button opens the tasks modal', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-tasks-button').click();
    await expect(page.getByTestId('tasks-board-modal')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('tasks-board-close').click();
    await expect(page.getByTestId('tasks-board-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  test('workflows button opens the automations panel', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-workflows-button').click();
    await expect(page.getByTestId('automations-host')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('automations-close').click();
    await expect(page.getByTestId('automations-host')).toHaveCount(0, { timeout: 5_000 });
  });

  // TODO(recording): the pending-dot (SidebarHeader.tsx WorkflowsBtn, `pending > 0` from
  // selectPendingInteractionCount(useAutomationsStore)) is populated by the automations WS
  // event stream when a run pauses on a needs-you interaction — there's no REST seed for that
  // state. Needs an automation fixture with a paused run; unskip once one exists.
  test.skip('workflows button shows a pending dot when a run needs input', async () => {});

  test('footer shows the daemon connected status', async () => {
    const { page } = app;
    // ConnDot renders <span aria-label="Connected"> for DaemonStatus 'connected'
    // (features/daemon/DaemonRow.tsx DAEMON_STATUS.connected.label) — the dot itself has no
    // dedicated testid, so we scope the aria-label lookup to the trigger's own testid.
    await expect(page.getByTestId('daemon-footer-trigger').locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  // TODO(flag): per-status footer count chips are hidden behind SHOW_SESSION_COUNTS = false
  // (layout/SidebarFooter.tsx, "hidden for now per product request" — counts stay computed,
  // ready to re-enable). Unskip when the flag flips back on.
  test.skip('footer idle count chip appears for a seeded, never-run chat', async () => {});

  // TODO(recording): the 'working' footer-count chip needs a live agent turn caught mid-stream.
  // mock-cli caps each replayed event's delay at 120ms (ReplaySession.MAX_DELAY_MS,
  // plugins/mock-cli/src/session.ts), so any recording's 'working' displayStatus window collapses
  // to well under a second end-to-end — not a window we can assert against race-free. Unlike
  // 'waiting' (see the describe below — a pending permission gate is a STABLE displayStatus that
  // persists until answered, chat-manager.ts:777's `hasPending ? 'waiting' : …` takes precedence
  // over 'working'), there's no daemon-side state that holds 'working' open deterministically.
  // Skipping rather than asserting a state we can't reliably observe; unskip with a purpose-built
  // slow fixture (e.g. a tool call recording with a long inter-event delay once MAX_DELAY_MS is
  // made configurable, or a live 'working'-holding daemon hook).
  test.skip('footer working count chip appears during an agent turn', async () => {});

  test('dragging the resize handle up grows the bottom panel', async () => {
    const { page } = app;
    await openInspector(page);
    const before = await getBottomPanelHeight(page);
    await dragResizeHandle(page, -60);
    const after = await getBottomPanelHeight(page);
    expect(after).toBeGreaterThan(before);
  });

  test('dragging the resize handle down clamps at the minimum height', async () => {
    const { page } = app;
    await openInspector(page);
    // BOTTOM_PANEL_MIN_HEIGHT = 120 (store/ui-prefs.ts clampBottomPanelHeight) — drag far past it.
    await dragResizeHandle(page, 1000);
    const after = await getBottomPanelHeight(page);
    expect(Math.round(after)).toBe(120);
  });

  test('hide-sidebar collapses the sidebar and show-sidebar-button restores it', async () => {
    const { page } = app;
    await expect(page.getByTestId('sessions-sidebar')).toBeVisible();
    await expect(page.getByTestId('show-sidebar-button')).toHaveCount(0);

    await page.getByTestId('sidebar-hide-button').click();
    await expect(page.getByTestId('sessions-sidebar')).toHaveCount(0, { timeout: 5_000 });

    const showButton = page.getByTestId('show-sidebar-button');
    await expect(showButton).toBeVisible({ timeout: 5_000 });
    await showButton.click();

    await expect(page.getByTestId('sessions-sidebar')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('show-sidebar-button')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ─── §sidebar-chrome — waiting count (a held permission gate is a stable state) ─

test.describe('§sidebar-chrome — footer waiting count', () => {
  // TODO(flag): the waiting chip is behind the same SHOW_SESSION_COUNTS = false flag
  // (layout/SidebarFooter.tsx) as the idle chip above. The permission-gate flow this
  // rode on is covered by gates.spec.ts; unskip when the flag flips back on.
  test.skip('the waiting count chip appears while a permission gate is pending and matches the pending count', async () => {});
});
