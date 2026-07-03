/**
 * §sidebar-chrome — SidebarHeader / SidebarFooter / bottom-panel resize chrome.
 *
 * Scope: docs/plans/2026-07-03-tauri-e2e-test-plan.md spec #5 (Cluster A).
 * UI-only — none of these scenarios need an agent-turn recording.
 *
 * Testid reference (verified against source):
 *   sidebar-settings-button    — layout/SidebarHeader.tsx SettingsBtn
 *   sidebar-tasks-button       — layout/SidebarHeader.tsx TasksBtn (dispatches `mf:open-tasks`)
 *   sidebar-workflows-button   — layout/SidebarHeader.tsx WorkflowsBtn (dispatches `mf:open-workflows`)
 *   sidebar-hide-button        — layout/SidebarHeader.tsx HideSidebarBtn (toggles ui-prefs.sidebarVisible)
 *   settings-dialog / settings-dialog-close — features/settings/SettingsDialog.tsx
 *   tasks-board-modal / tasks-board-close   — features/tasks/TasksBoard.tsx (mounted by TasksModalHost)
 *   workflows-modal            — features/workflows/WorkflowsModalHost.tsx DialogContent
 *   sessions-sidebar           — layout/SidebarShell.tsx root (unmounts entirely when hidden — AppShell.tsx
 *                                `{sidebarRendered && <SidebarShell/>}`)
 *   show-sidebar-button        — layout/MainToolbar.tsx (rendered only when `!sidebarRendered`)
 *   daemon-footer-trigger      — features/daemon/DaemonFooterStatus.tsx popover trigger
 *   sidebar-footer-count-<idle|working|waiting> — layout/SidebarFooter.tsx (only rendered when count > 0)
 *   sidebar-bottom-resize      — features/context-panel/PanelResizeHandle.tsx (role=separator, pointer-drag)
 *   sidebar-bottom-tab-track   — features/context-panel/BottomPanel.tsx (used below only as a DOM anchor to
 *                                read the panel's own height style — the panel's root <div style={{height}}>
 *                                itself carries no testid; flagged in the report)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

/** BottomPanel's root <div style={{height}}> has no testid; walk up from the tab-track
 *  testid anchor (its grandparent) to read the panel's live height via bounding box. */
async function getBottomPanelHeight(page: Page): Promise<number> {
  const box = await page.getByTestId('sidebar-bottom-tab-track').locator('xpath=ancestor::div[2]').boundingBox();
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
    // One never-run chat — the fixture the footer idle-count assertion needs.
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

  test('workflows button opens the workflows modal', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-workflows-button').click();
    await expect(page.getByTestId('workflows-modal')).toBeVisible({ timeout: 10_000 });
    // Close via the real close button, not Escape — see the TODO(bug) test below
    // for why a single Escape press doesn't close this dialog.
    await page.getByTestId('workflows-close').click();
    await expect(page.getByTestId('workflows-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  // TODO(bug): a single Escape press does not close the workflows modal. Triaged
  // live via `document.activeElement` + a console listener: Radix Dialog's
  // default `onOpenAutoFocus` moves keyboard focus to the first focusable
  // element inside DialogContent, which is the `workflows-close` button
  // (WorkflowsView.tsx) — and that button is wrapped in the shared `Hint`
  // tooltip primitive. Radix Tooltip shows on focus (not just hover), so
  // opening the modal ALSO opens a stray "Close" tooltip on top of it
  // (confirmed: `data-state="instant-open"` on the button right after open).
  // Radix's dismissable-layer stack closes only the TOPMOST layer on Escape —
  // the tooltip is on top, so the first Escape dismisses the tooltip
  // (`data-state` flips to "closed") and the dialog stays open; a second
  // Escape would be needed to actually close it. This isn't specific to
  // Workflows — any dialog whose first focusable element is a Hint-wrapped
  // icon button (see the `app-tauri-hint-tooltip-primitive` pattern) inherits
  // the same "Escape closes the tooltip, not the dialog" first-press bug. See
  // packages/ui/src/features/workflows/WorkflowsView.tsx `workflows-close` +
  // packages/ui/src/components/ui/hint.tsx.
  test('TODO(bug): Escape closes the workflows modal on the first press', () => {
    test.skip(
      true,
      "TODO(bug): first Escape dismisses the auto-focused close button's Hint tooltip, not the dialog — see comment above",
    );
  });

  // TODO(recording): the pending-dot (SidebarHeader.tsx WorkflowsBtn, `pending > 0` from
  // useWorkflowsStore.selectPendingCount / state.interactions.length) is populated by the
  // workflows WS event stream when a run pauses on a needs-you interaction — there's no REST
  // seed for that state. Needs a workflow fixture with a paused run; unskip once one exists.
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

  test('footer idle count chip appears for a seeded, never-run chat', async () => {
    const { page } = app;
    const idleChip = page.getByTestId('sidebar-footer-count-idle');
    await expect(idleChip).toBeVisible({ timeout: 10_000 });
    await expect(idleChip).toHaveText('1');
    // COUNT_META filters zero-count entries (layout/SidebarFooter.tsx) — with one idle chat
    // and no run ever started, working/waiting must not render at all.
    await expect(page.getByTestId('sidebar-footer-count-working')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-footer-count-waiting')).toHaveCount(0);
  });

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
    const before = await getBottomPanelHeight(page);
    await dragResizeHandle(page, -60);
    const after = await getBottomPanelHeight(page);
    expect(after).toBeGreaterThan(before);
  });

  test('dragging the resize handle down clamps at the minimum height', async () => {
    const { page } = app;
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
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-interactive' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the waiting count chip appears while a permission gate is pending and matches the pending count', async () => {
    const { page } = app;
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');

    // A pending permission gate holds the chat's displayStatus at 'waiting'
    // (chat-manager.ts: `hasPending ? 'waiting' : …` takes precedence over 'working') until
    // answered — unlike 'working', this is a stable, race-free window to assert against.
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });

    const waitingChip = page.getByTestId('sidebar-footer-count-waiting');
    await expect(waitingChip).toBeVisible({ timeout: 10_000 });
    await expect(waitingChip).toHaveText('1');
    await expect(page.getByTestId('sidebar-footer-count-working')).toHaveCount(0);

    await page.getByTestId('chat-permission-deny').click();
    await waitForIdle(page, 60_000);
    await expect(waitingChip).toHaveCount(0, { timeout: 10_000 });
  });
});
