/**
 * §run-surface — the Run surface (terminal + launch-config panes) specs.
 *
 * Cluster C, spec #21 of docs/plans/2026-07-03-tauri-e2e-test-plan.md. UI-only in
 * the sense that no AI turns are involved — no recording/E2E_MODE needed — but
 * exercises REAL daemon-spawned processes via `.mainframe/launch.json` launch
 * configs (the daemon spawns actual `sleep`/`echo`/`node` child processes; this
 * is independent of the mock-CLI machinery used for chat/agent specs).
 *
 * Source read: packages/ui/src/layout/surfaces/RunSurface.tsx,
 * packages/ui/src/layout/RunTabStrip.tsx, packages/ui/src/layout/SurfacePicker.tsx
 * (RunPickerContent), packages/ui/src/features/terminal/create-terminal.ts +
 * packages/ui/src/store/terminal-intent-subscriber.ts, packages/ui/src/lib/host/
 * fake-adapter.ts, packages/ui/src/features/run/{use-launch-actions,
 * use-launch-configs,ToolbarLaunchControls}.tsx, packages/core/src/launch/
 * {launch-config,launch-manager}.ts, packages/core/src/server/routes/launch.ts.
 *
 * PTY-degraded behavior (verified against fake-adapter.ts + create-terminal.ts):
 * `FakeHostBridge.terminal.create()` (the browser-mode host used by this harness)
 * unconditionally REJECTS ("terminal.create is not available in browser/dev mode
 * (no host)"). `createTerminalSession` disposes its cache entry and re-throws;
 * `spawnTerminal` (terminal-intent-subscriber.ts) catches that rejection and only
 * `console.warn`s — it never calls `addRunTab`. So in browser mode, clicking
 * "New terminal" produces **no tab and no pane** (not a degraded/errored tab as
 * the dispatch note speculated) — the surface stays on its picker / the pane's
 * tab count is unchanged. Assertions below reflect that reality: no crash + no
 * new tab, not "tab appears but PTY fails".
 *
 * Launch configs are read from `<project>/.mainframe/launch.json` on disk (GET
 * /api/projects/:id/launch/configs), not seeded via a daemon REST endpoint — this
 * file writes that file directly into the REST-seeded project directory before
 * navigating, mirroring files-tree.spec.ts's direct-git-mutation pattern. Three
 * configs cover the plan's scenarios: `sleep-long` (long-running, no port — goes
 * straight to 'running'), `echo-once` (short-lived, produces stdout the daemon
 * captures before exit — for the console-pane-logs scenario), `exit-immediately`
 * (non-zero exit — for the failed-state scenario).
 *
 * Testid reference (all verified against source):
 *   surface-rail-run                          — MainToolbar rail toggle (⌘3)
 *   run-surface / run-surface-picker          — RunSurface root / empty-state picker
 *   run-picker-new-terminal / run-picker-launch-<name> — picker rows
 *   run-pane-<paneId>                         — a Run pane
 *   run-tab-<id> / run-tab-close-<id>         — a tab pill / its close button
 *   run-tab-strip-add-<paneId> / run-add-menu-<paneId> — the "+" popover trigger/content
 *   run-pane-new-terminal-<paneId> / run-pane-launch-<config>-<paneId> — its rows
 *   run-tab-strip-split-right / run-tab-strip-split-down / run-surface-close — primary-pane controls
 *   run-pane-close-<paneId>                   — secondary-pane close (un-split)
 *   run-console-pane                          — full-space ConsolePane (process tabs)
 *   main-toolbar-launch / main-toolbar-launch-popover — toolbar launch picker (shared status source)
 *   main-toolbar-launch-start-<name> / -stop-<name> — per-config start/stop (status-derived)
 *   files-surface / files-surface-picker / files-tab-strip-add / files-tab-strip-close
 *   file-picker-dialog / file-picker-input / file-picker-row-<path>
 *   drop-zone-right / surface-drag-layer      — Files-tab-to-Run drag (setup for secondary-pane close)
 *   chat-header-hide                          — hides Chat (dynamic-floor setup)
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// `[data-testid^="run-pane-"]` alone over-matches: `run-pane-close-<paneId>`,
// `run-pane-new-terminal-<paneId>`, and `run-pane-launch-<config>-<paneId>` (the
// add-menu rows, per RunTabStrip.tsx's own testid reference) all share the same
// prefix as the real pane wrapper `run-pane-<paneId>`. Verified live: after a
// 2-pane split, the bare prefix locator resolved to 3 elements (2 panes + the
// secondary pane's `run-pane-close-*` button) — not a product bug, a test-selector
// bug. This locator excludes the known non-pane variants.
const RUN_PANE_SELECTOR =
  '[data-testid^="run-pane-"]:not([data-testid^="run-pane-close-"]):not([data-testid^="run-pane-new-terminal-"]):not([data-testid^="run-pane-launch-"])';

/** Write a `.mainframe/launch.json` with the three configs this spec exercises. */
function seedLaunchConfigs(projectPath: string): void {
  const dir = path.join(projectPath, '.mainframe');
  mkdirSync(dir, { recursive: true });
  const config = {
    version: '1.0',
    configurations: [
      // No `port` → launch-manager.ts skips waitForPort and goes straight to
      // 'running' once spawned; stays alive for the start/stop + status scenarios.
      { name: 'sleep-long', runtimeExecutable: 'sleep', runtimeArgs: ['60'] },
      // Exits almost immediately (status 0 → 'stopped') but stdout is captured
      // before exit — used for the console-pane-logs scenario.
      { name: 'echo-once', runtimeExecutable: 'echo', runtimeArgs: ['hello-from-launch'] },
      // Exits immediately with a non-zero code → 'failed'.
      { name: 'exit-immediately', runtimeExecutable: 'node', runtimeArgs: ['-e', 'process.exit(1)'] },
    ],
  };
  writeFileSync(path.join(dir, 'launch.json'), JSON.stringify(config, null, 2));
}

/** Toggle the Run surface on via the rail's ⌘3 shortcut (per the dispatch note). */
async function turnRunSurfaceOn(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+3');
  await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 10_000 });
}

/** Poll the daemon's launch-status REST endpoint for a config's status. */
async function launchStatus(page: Page, projectId: string, name: string): Promise<string | undefined> {
  const res = await page.request.get(`${DAEMON_BASE}/api/projects/${projectId}/launch/status`);
  const body = (await res.json()) as { data?: { statuses?: Record<string, string> } };
  return body.data?.statuses?.[name];
}

// ─── §21a Empty-state picker + new-terminal (browser-mode degraded) ────────────

test.describe('§21 run-surface — empty-state picker + new-terminal (degraded)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    await turnRunSurfaceOn(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the empty-state picker lists New terminal and every launch config', async () => {
    const { page } = app;
    await expect(page.getByTestId('run-surface-picker')).toBeVisible();
    await expect(page.getByTestId('run-picker-new-terminal')).toBeVisible();
    await expect(page.getByTestId('run-picker-launch-sleep-long')).toBeVisible();
    await expect(page.getByTestId('run-picker-launch-echo-once')).toBeVisible();
    await expect(page.getByTestId('run-picker-launch-exit-immediately')).toBeVisible();
  });

  test('New terminal fails gracefully in browser mode: no tab, no crash, picker persists', async () => {
    const { page } = app;
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.getByTestId('run-picker-new-terminal').click();

    // FakeHostBridge.terminal.create() rejects; spawnTerminal only console.warns
    // and never calls addRunTab — so the surface never leaves the picker state.
    await expect(page.getByTestId('run-surface-picker')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(RUN_PANE_SELECTOR)).toHaveCount(0);
    // The app must still be responsive — the rail toggle remains a live control.
    await expect(page.getByTestId('surface-rail-run')).toBeEnabled();
    expect(pageErrors).toHaveLength(0);
  });
});

// ─── §21b Tab strip, per-pane "+" menu, launch start/stop, console logs ────────

test.describe('§21 run-surface — tab strip, add-menu, launch lifecycle, console logs', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    await turnRunSurfaceOn(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('starting a launch config from the picker opens a tab and reaches running status', async () => {
    const { page } = app;
    await page.getByTestId('run-picker-launch-sleep-long').click();

    // addRunTab is a synchronous, optimistic local-store update — the tab shows
    // up immediately, independent of the daemon confirming the process started.
    const pane = page.locator(RUN_PANE_SELECTOR).first();
    await expect(pane).toBeVisible({ timeout: 5_000 });
    const tab = page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'sleep-long' });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    // Status confirmation: RunTabStrip's own pill carries no status glyph, so we
    // read it from the toolbar's launch picker, which shares the same
    // useLaunchActions/scopeStatuses source — the Stop button only renders once
    // status is 'running' or 'starting'.
    await page.getByTestId('main-toolbar-launch').click();
    await expect(page.getByTestId('main-toolbar-launch-stop-sleep-long')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
  });

  test('the per-pane "+" popover lists New terminal and the launch configs; New terminal is a no-op', async () => {
    const { page } = app;
    const pane = page.locator(RUN_PANE_SELECTOR).first();
    const paneId = (await pane.getAttribute('data-testid'))!.replace('run-pane-', '');
    const tabCountBefore = await page.locator(`[data-testid="run-pane-${paneId}"] [role="tab"]`).count();

    await page.getByTestId(`run-tab-strip-add-${paneId}`).click();
    await expect(page.getByTestId(`run-add-menu-${paneId}`)).toBeVisible();
    await expect(page.getByTestId(`run-pane-new-terminal-${paneId}`)).toBeVisible();
    await expect(page.getByTestId(`run-pane-launch-echo-once-${paneId}`)).toBeVisible();
    await expect(page.getByTestId(`run-pane-launch-exit-immediately-${paneId}`)).toBeVisible();

    await page.getByTestId(`run-pane-new-terminal-${paneId}`).click();
    await expect(page.getByTestId(`run-add-menu-${paneId}`)).toHaveCount(0);
    // Same PTY-unavailable no-op as the empty-state picker: tab count in this
    // pane is unchanged.
    await expect(page.locator(`[data-testid="run-pane-${paneId}"] [role="tab"]`)).toHaveCount(tabCountBefore);
  });

  // Previously: the console pane never showed `echo-once`'s stdout — a fast
  // subprocess's entire lifecycle (spawn → stdout → exit) could finish before
  // a console pane's live WS delivery was observed. Fixed by the
  // product-bug-fix campaign: `use-launch-configs.ts`'s `seedOutputBuffer`
  // now seeds a config's console from the daemon's buffered output replay
  // (`LaunchManager.getOutputBuffer`) whenever nothing has appeared live yet
  // for that scope+name, closing the race without duplicating live output.
  test('launching echo-once from the add-menu opens a second tab whose console shows its output', async () => {
    const { page } = app;
    const pane = page.locator(RUN_PANE_SELECTOR).first();
    const paneId = (await pane.getAttribute('data-testid'))!.replace('run-pane-', '');

    await page.getByTestId(`run-tab-strip-add-${paneId}`).click();
    await page.getByTestId(`run-pane-launch-echo-once-${paneId}`).click();

    const echoTab = page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'echo-once' });
    await expect(echoTab).toBeVisible({ timeout: 5_000 });
    // Launching activates the new tab.
    await expect(echoTab).toHaveAttribute('aria-selected', 'true');

    // Both sleep-long and echo-once are `console`-kind tabs, so RunTabBody mounts
    // a `run-console-pane` for EACH (toggling only its wrapper's CSS visibility,
    // never unmounting) — `getByTestId` alone would resolve to 2 elements. Scope
    // to the one that's actually visible (the just-activated echo-once tab).
    const visibleConsole = page.locator('[data-testid="run-console-pane"]:visible');
    await expect(visibleConsole).toBeVisible();
    await expect(visibleConsole).toContainText('hello-from-launch', { timeout: 15_000 });
  });

  // Depended on the echo-once tab from the test above (this describe is an
  // ordered sequence, matching editor.spec.ts's convention — no per-test setup
  // recreates it); re-enabled together with the echo-once fix.
  test('tab activate: clicking a pill switches which console is selected', async () => {
    const { page } = app;
    const sleepTab = page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'sleep-long' });
    const echoTab = page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'echo-once' });

    await sleepTab.click();
    await expect(sleepTab).toHaveAttribute('aria-selected', 'true');
    await expect(echoTab).toHaveAttribute('aria-selected', 'false');

    await echoTab.click();
    await expect(echoTab).toHaveAttribute('aria-selected', 'true');
    await expect(sleepTab).toHaveAttribute('aria-selected', 'false');
  });

  // Same dependency as above — needs the echo-once tab from "launching
  // echo-once…" above.
  test('tab close: closing echo-once removes it, leaving only sleep-long', async () => {
    const { page } = app;
    const echoTabId = await page
      .locator('[data-testid^="run-tab-"][role="tab"]')
      .filter({ hasText: 'echo-once' })
      .getAttribute('data-testid');
    const id = echoTabId!.replace('run-tab-', '');

    await page.getByTestId(`run-tab-close-${id}`).click();
    await expect(page.getByTestId(`run-tab-${id}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'sleep-long' })).toBeVisible();
  });

  // Previously: this reproducibly hung on "Stop" forever — a stale-response
  // overwrite in `useLaunchConfigs`. Opening the toolbar's launch popover
  // calls `refetch()`, kicking off a REST `GET /launch/status` fetch; if that
  // fetch resolved AFTER a WS `launch.status:'stopped'` event (e.g. Stop
  // clicked right after the popover reopens), it unconditionally clobbered
  // the correct 'stopped' state back to the stale pre-stop 'running' snapshot.
  // Fixed by the product-bug-fix campaign: `reconcileFetchedStatus` now
  // compares the fetch's pre-request snapshot against the store's CURRENT
  // live status and skips applying the stale REST value when a WS update has
  // superseded it.
  test('Stop reverts the toolbar to Start for sleep-long', async () => {
    const { page } = app;
    await page.getByTestId('main-toolbar-launch').click();
    await page.getByTestId('main-toolbar-launch-stop-sleep-long').click();
    await expect(page.getByTestId('main-toolbar-launch-start-sleep-long')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');

    // The tab itself is not removed on stop, only its status changes.
    await expect(page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'sleep-long' })).toBeVisible();
  });
});

// ─── §21c Failed launch config ───────────────────────────────────────────────

test.describe('§21 run-surface — failed launch config', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    await turnRunSurfaceOn(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Previously: `LaunchManager.getAllStatuses()`/`getStatus()` read live from
  // `this.processes`, but the child's own 'exit' handler set the terminal
  // status and THEN synchronously deleted the `this.processes` entry in the
  // same tick — so a terminal status was never observable via REST
  // (`statuses[name]` read `undefined` forever). Fixed by the
  // product-bug-fix campaign: status is now tracked in a dedicated
  // `LaunchProcessState` store (`launch-process-state.ts`) that survives the
  // `this.processes` entry being deleted.
  test('a config that exits non-zero reaches failed status; its tab is not removed', async () => {
    const { page } = app;
    await page.getByTestId('run-picker-launch-exit-immediately').click();

    const tab = page.locator('[data-testid^="run-tab-"][role="tab"]').filter({ hasText: 'exit-immediately' });
    await expect(tab).toBeVisible({ timeout: 5_000 });

    // No dedicated "Failed" UI text exists on the console tab (verified: neither
    // RunTabStrip's tabGlyph nor ConsolePane render a status word) — the daemon's
    // own launch-status endpoint is the observable source of truth here.
    await expect
      .poll(() => launchStatus(page, project.projectId, 'exit-immediately'), { timeout: 15_000 })
      .toBe('failed');

    // The tab survives the process exiting — closing it is a distinct user action.
    await expect(tab).toBeVisible();
  });
});

// ─── §21d Run's own split controls, secondary-pane close, close-at-floor ──────

test.describe('§21 run-surface — split controls, secondary-pane close, close-at-floor', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    seedLaunchConfigs(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    await turnRunSurfaceOn(app.page);
    // Give the primary pane content so RunTabStrip (and its split/close controls)
    // is mounted — SurfacePicker has no such controls.
    await app.page.getByTestId('run-picker-launch-sleep-long').click();
    await expect(app.page.locator(RUN_PANE_SELECTOR).first()).toBeVisible({ timeout: 5_000 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test("run-tab-strip-split-right (Run's own header) brings in the Files surface", async () => {
    const { page } = app;
    await expect(page.getByTestId('files-surface')).toHaveCount(0);
    await page.getByTestId('run-tab-strip-split-right').click();
    await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 5_000 });
  });

  test("secondary-pane close: dragging a Files tab onto Run's edge splits it, then run-pane-close un-splits it", async () => {
    const { page } = app;

    // Open a Files tab so there is something to drag (mirrors layout.spec.ts's
    // established Files-tab-to-Run drag technique — reused locally here only to
    // reach the untested `run-pane-close-<paneId>` action itself).
    await page.getByTestId('files-tab-strip-add').click();
    await page.getByTestId('file-picker-dialog').waitFor({ timeout: 5_000 });
    await page.getByTestId('file-picker-input').fill('index.ts');
    const row = page.locator('[data-testid^="file-picker-row-"]').filter({ hasText: 'index.ts' }).first();
    await row.waitFor({ timeout: 5_000 });
    await row.click();
    const filesTab = page.locator('[data-testid="files-tab-strip"]').getByRole('tab').first();
    await filesTab.waitFor({ timeout: 5_000 });

    const tabBox = await filesTab.boundingBox();
    if (!tabBox) throw new Error('files tab has no bounding box');
    const runBox = await page.locator('[data-drop-surface="run"]').boundingBox();
    if (!runBox) throw new Error('run pane has no bounding box');
    const edgeTarget = { x: runBox.x + runBox.width * 0.95, y: runBox.y + runBox.height / 2 };

    await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(tabBox.x + tabBox.width / 2 + 8, tabBox.y + tabBox.height / 2 + 8, { steps: 2 });
    await page.mouse.move(edgeTarget.x, edgeTarget.y, { steps: 6 });
    await expect(page.getByTestId('drop-zone-right')).toBeVisible({ timeout: 3_000 });
    await page.mouse.up();

    await expect(page.locator(RUN_PANE_SELECTOR)).toHaveCount(2, { timeout: 5_000 });
    const closeSecondary = page.locator('[data-testid^="run-pane-close-"]');
    await expect(closeSecondary).toBeVisible({ timeout: 5_000 });

    await closeSecondary.click();
    await expect(page.locator(RUN_PANE_SELECTOR)).toHaveCount(1);
    await expect(page.locator('[data-testid^="run-pane-close-"]')).toHaveCount(0);
  });

  test('run-surface-close is disabled once Run becomes the sole lit surface (the dynamic floor)', async () => {
    const { page } = app;
    // litCount is 3 here (chat, files, run — Files was brought in by the prior
    // "split-right" test and survives the drag test as an empty picker) — bring
    // it down to 1 (Run alone).
    await expect(page.getByTestId('files-surface')).toBeVisible();
    await page.getByTestId('surface-rail-files').click();
    await expect(page.getByTestId('files-surface')).toHaveCount(0);

    await page.getByTestId('chat-header-hide').click();
    await expect(page.getByTestId('chat-header')).toHaveCount(0);

    await expect(page.getByTestId('run-surface-close')).toBeDisabled();
    await expect(page.getByTestId('surface-rail-run')).toBeDisabled();
  });
});
