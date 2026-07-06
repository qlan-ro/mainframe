/**
 * §daemon-picker — the sidebar footer daemon trigger, its picker popover, the
 * add-remote pairing dialog, and the rename/remove/unreachable surfaces.
 *
 * Spec: docs/plans/2026-07-03-tauri-e2e-test-plan.md #8 (Cluster A, P3 — lowest
 * priority in the wave; scenarios below are deliberately conservative).
 *
 * Source: packages/ui/src/features/daemon/{DaemonFooterStatus,DaemonPicker,
 * DaemonRow,AddRemoteDialog,pairing-steps,PairCodeInput,DaemonSmallDialog,
 * DaemonUnreachableBody,use-daemon-registry,active-daemon-context}.
 *
 * Testid reference (verified against source):
 *   daemon-footer-trigger        — DaemonFooterStatus popover trigger; ConnDot
 *                                   inside carries aria-label Connected/Connecting…/Unreachable
 *   daemon-picker                — DaemonPicker root
 *   daemon-picker-empty          — "No remote daemons yet…" empty state
 *   daemon-picker-add            — "Add remote daemon…" footer row
 *   daemon-row-<id>              — DaemonRow root (id='local' for the synthetic local entry)
 *   daemon-row-<id>-active       — Check icon, only rendered when that row is active
 *   daemon-row-<id>-dot          — wrapper around ConnDot (aria-label carries the status word)
 *   daemon-row-<id>-manage       — ⋯ button, remote rows only
 *   daemon-row-<id>-rename / -repair / -remove — manage popover menu rows
 *   daemon-add-url / daemon-add-verify / daemon-add-continue / daemon-add-back /
 *   daemon-add-close / daemon-add-device / daemon-add-confirm / daemon-pair-code
 *                                 — AddRemoteDialog (pairing-steps.tsx)
 *   daemon-rename-dialog / daemon-rename-input / daemon-rename-save
 *   daemon-remove-dialog / daemon-remove-confirm
 *   daemon-unreachable / daemon-unreachable-switchlocal — DaemonUnreachableBody
 *     (rendered inside ConnectionOverlay, portalled to document.body)
 *
 * Ground-truth note on the dispatch's "seed via localStorage" lever: there is no
 * localStorage-backed daemon registry. In browser mode `getHost()` resolves to
 * `FakeHostBridge` (lib/host/fake-adapter.ts), which holds `daemons` in a plain
 * in-memory `Map` with no persistence — a `page.reload()` wipes it. Likewise the
 * "active daemon" singleton (lib/daemon/active-daemon.ts) is a bare in-module
 * variable. The connection state that gates the unreachable overlay
 * (`useConnectionState` in app/useConnectionState.ts) polls the LOCAL daemon's
 * fixed `/health` port unconditionally — it is NOT aware of which daemon is
 * "active" — so merely switching to an unreachable remote's WS target never
 * flips `connState` to `disconnected` on its own (this matches the module doc
 * in DaemonFooterStatus.tsx: "no live polling — documented known
 * simplification"). Adapted approach used below instead of localStorage seeding:
 *   1. A real remote daemon entry is added by driving the actual AddRemoteDialog
 *      pairing flow, with `page.route()` mocking only the `/health` and
 *      `/api/auth/confirm` calls to the fake remote origin (network-level fault
 *      injection, not fabricated React/store state).
 *   2. The unreachable overlay is then forced by intercepting the LOCAL daemon's
 *      `/health` poll (the actual signal `connState` reacts to) with
 *      `route.abort()`, while the remote stays active — this reproduces the real
 *      `showUnreachableOverlay` condition through the app's real polling loop.
 * Every daemon switch in this suite is undone before the describe ends (CAUTION
 * in the dispatch); the final test re-asserts the app is back on the local daemon.
 *
 * FIXED BUG (previously triaged live, now fixed — see the "pairing
 * auto-switches…" test below): completing pairing used to not auto-switch the
 * active daemon, and the "Paired" confirmation was never visible.
 * `AddRemoteDialog.handleConfirm`'s `registry.switchTo(meta.id)` closed over a
 * stale pre-add `remotes` snapshot, and `DaemonFooterStatus` wired both
 * `onDone` and `onClose` to the same `closeDialog` callback, collapsing the
 * documented 800ms "Paired" grace window to zero. Both are fixed
 * (`use-daemon-registry.ts`'s `switchTo` now reads a live module-level
 * snapshot; `onDone`/`onClose` are separate callbacks) — pairing now switches
 * on the first click and briefly shows "Paired".
 *
 * FIXED BUGS (see the "pairing auto-switches…" and "manage menu
 * rename/remove…" tests below): (1) the auto-switch above used to remount
 * `<AppShell key={target.id}>` synchronously inside `handleConfirm`,
 * destroying the still-open `AddRemoteDialog` before it reached the "done"
 * phase — `AddRemoteDialog.handleConfirm` now defers `registry.switchTo()`
 * until after the dialog's own deferred `onClose`. (2) the picker Popover
 * (`DaemonFooterStatus.tsx`) used to close itself whenever the nested
 * rename/remove `DaemonSmallDialog` dismissed (Radix modal-Dialog-vs-Popover
 * interaction) — `DaemonFooterStatus` now suppresses the Popover's
 * `onOpenChange(false)` while a dialog is open.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { waitConnected } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const LOCAL_HEALTH_URL = `http://127.0.0.1:${DAEMON_PORT}/health`;

/** Suffix-scoped locators — safe because at most one remote daemon exists at a
 *  time by the point these are used (the auto-switch test below adds and then
 *  removes its own second remote before any other test runs), so there is
 *  never an id-ambiguity to resolve. `renameMenuRow`/`removeMenuRow` are safe
 *  even with 2+ remotes present because Radix Popover only mounts its portalled
 *  `PopoverContent` (and thus these testids) while open, and only one manage
 *  popover is ever open at a time. */
function remoteRow(page: Page) {
  return page.locator('[data-testid^="daemon-row-"]').filter({ has: page.locator('[data-testid$="-manage"]') });
}
function manageButton(page: Page) {
  return page.locator('[data-testid$="-manage"]');
}
function renameMenuRow(page: Page) {
  return page.locator('[data-testid$="-rename"]');
}
function removeMenuRow(page: Page) {
  return page.locator('[data-testid$="-remove"]');
}
/** Scopes a remote row by a substring of its displayed `d.host` text (e.g. a
 *  port) — needed only while 2 remotes briefly coexist (the auto-switch test's
 *  own second pairing), where the generic `remoteRow`/`manageButton` helpers
 *  above would be ambiguous. */
function daemonRowByHost(page: Page, hostSubstr: string) {
  return page.locator('[data-testid^="daemon-row-"]').filter({ hasText: hostSubstr });
}

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId('daemon-footer-trigger').click();
  await page.getByTestId('daemon-picker').waitFor({ timeout: 10_000 });
}

async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('daemon-picker')).toHaveCount(0, { timeout: 5_000 });
}

test.describe('§daemon-picker', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('footer trigger opens the daemon picker', async () => {
    const { page } = app;
    await openPicker(page);
    await expect(page.getByTestId('daemon-row-local')).toBeVisible();
    await closePicker(page);
  });

  test('local daemon row shows the active check and a connected status dot', async () => {
    const { page } = app;
    await openPicker(page);
    await expect(page.getByTestId('daemon-row-local-active')).toBeVisible();
    await expect(page.getByTestId('daemon-row-local-dot').locator('[aria-label="Connected"]')).toBeVisible();
    await closePicker(page);
  });

  test('add-remote dialog walks the URL step to the device step, back navigation, and closes without pairing', async () => {
    const { page } = app;
    const origin = 'http://127.0.0.1:58201';
    await page.route(`${origin}/health`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) });
    });

    try {
      await openPicker(page);
      await page.getByTestId('daemon-picker-add').click();
      await expect(page.getByTestId('daemon-add-url')).toBeVisible();

      // Step 0 — URL, verify
      await page.getByTestId('daemon-add-url').fill(origin);
      await page.getByTestId('daemon-add-verify').click();
      await expect(page.getByText(/Daemon reachable/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('daemon-add-continue')).toBeVisible();

      // Step 1 — device/code, reached via Continue
      await page.getByTestId('daemon-add-continue').click();
      await expect(page.getByTestId('daemon-pair-code')).toBeVisible();
      await expect(page.getByTestId('daemon-add-device')).toBeVisible();

      // Back returns to step 0
      await page.getByTestId('daemon-add-back').click();
      await expect(page.getByTestId('daemon-add-url')).toBeVisible();
      await expect(page.getByTestId('daemon-pair-code')).toHaveCount(0);

      // Close without ever calling confirm/pair
      await page.getByTestId('daemon-add-close').click();
      await expect(page.getByTestId('daemon-add-url')).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await page.unroute(`${origin}/health`);
    }

    await openPicker(page);
    await expect(page.getByTestId('daemon-picker-empty')).toBeVisible();
    await closePicker(page);
  });

  test('an unreachable server URL shows the error state with a retry action', async () => {
    const { page } = app;
    // A loopback port nothing is listening on — real connection-refused failure,
    // not a mocked one; deterministic on a sandboxed CI/dev loopback interface.
    const deadOrigin = 'http://127.0.0.1:59991';

    await openPicker(page);
    await page.getByTestId('daemon-picker-add').click();
    await expect(page.getByTestId('daemon-add-url')).toBeVisible();

    await page.getByTestId('daemon-add-url').fill(deadOrigin);
    await page.getByTestId('daemon-add-verify').click();

    await expect(page.getByText(/Couldn.t reach this URL/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    // Continue must not appear for an unreachable URL — Verify/Retry only.
    await expect(page.getByTestId('daemon-add-continue')).toHaveCount(0);

    await page.getByTestId('daemon-add-close').click();
    await expect(page.getByTestId('daemon-add-url')).toHaveCount(0, { timeout: 5_000 });
  });

  test('completing pairing adds a remote daemon row', async () => {
    const { page } = app;
    const origin = 'http://127.0.0.1:58202';
    await page.route(`${origin}/health`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) });
    });
    await page.route(`${origin}/api/auth/confirm`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { token: 'e2e-fake-token', deviceId: 'e2e-fake-device' } }),
      });
    });

    await openPicker(page);
    await page.getByTestId('daemon-picker-add').click();
    await expect(page.getByTestId('daemon-add-url')).toBeVisible();

    await page.getByTestId('daemon-add-url').fill(origin);
    await page.getByTestId('daemon-add-verify').click();
    await expect(page.getByTestId('daemon-add-continue')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('daemon-add-continue').click();

    await expect(page.getByTestId('daemon-pair-code')).toBeVisible();
    await page.getByTestId('daemon-pair-code').locator('input').first().click();
    await page.keyboard.type('ABC123');
    await page.getByTestId('daemon-add-device').fill('E2E Remote Device');

    const confirmButton = page.getByTestId('daemon-add-confirm');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // The dialog now closes only after the 800ms deferred onClose (see the
    // auto-switch test below for the fix); either way, it's gone by now.
    await expect(page.getByTestId('daemon-add-url')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('daemon-pair-code')).toHaveCount(0, { timeout: 5_000 });

    // The row is added — label is derived from the host
    // ("127.0.0.1:58202".split('.')[0] === "127"). Pairing also auto-switches
    // the active daemon now (fixed — see the auto-switch test below), so this
    // describe no longer ends on local until that test resets it.
    await openPicker(page);
    await expect(remoteRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(remoteRow(page)).toContainText('127');
    await closePicker(page);
  });

  // FIXED: `registry.switchTo()` used to fire synchronously inside
  // `handleConfirm`, before the "done"/"Paired" phase rendered. Since
  // `App.tsx` mounts `<AppShell key={target.id}>`, that switch immediately
  // remounted the daemon-scoped subtree — which is where this very dialog
  // lives — destroying it mid-`handleConfirm()` before the "Paired"
  // confirmation could ever render. `AddRemoteDialog.handleConfirm` now defers
  // `registry.switchTo()` until the dialog's own 800ms deferred `onClose`
  // fires, so the remount happens only after the dialog has shown "Paired"
  // and closed itself.
  test('pairing auto-switches the active daemon and shows a "Paired" confirmation', async () => {
    const { page } = app;

    // With the fix, "completing pairing adds a remote daemon row" above now ALSO
    // auto-switches — establish a known starting state (local) so this test's own
    // auto-switch assertion below is meaningful, not just inherited ambient state.
    await openPicker(page);
    await page.getByTestId('daemon-row-local').click();
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('daemon-picker')).toHaveCount(0, { timeout: 5_000 });

    const origin = 'http://127.0.0.1:58203';
    await page.route(`${origin}/health`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) });
    });
    await page.route(`${origin}/api/auth/confirm`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { token: 'e2e-fake-token-2', deviceId: 'e2e-fake-device-2' } }),
      });
    });

    await openPicker(page);
    await page.getByTestId('daemon-picker-add').click();
    await expect(page.getByTestId('daemon-add-url')).toBeVisible();

    await page.getByTestId('daemon-add-url').fill(origin);
    await page.getByTestId('daemon-add-verify').click();
    await expect(page.getByTestId('daemon-add-continue')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('daemon-add-continue').click();

    await expect(page.getByTestId('daemon-pair-code')).toBeVisible();
    await page.getByTestId('daemon-pair-code').locator('input').first().click();
    await page.keyboard.type('ABC123');
    await page.getByTestId('daemon-add-device').fill('E2E Auto-switch Device');

    const confirmButton = page.getByTestId('daemon-add-confirm');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // The confirm button's own label flips to "Paired" (disabled) for the
    // 800ms deferred-close window (pairing-steps.tsx FooterStep1) — a real
    // window to observe, not the instant-close before the fix.
    await expect(confirmButton).toHaveText('Paired', { timeout: 2_000 });
    await expect(page.getByTestId('daemon-add-url')).toHaveCount(0, { timeout: 5_000 });

    // Pairing itself auto-switches the active daemon — no second click needed
    // (started this test on local, above; it's since moved off it).
    await expect(page.getByTestId('daemon-footer-trigger')).not.toContainText('This Mac', { timeout: 10_000 });
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('127', { timeout: 10_000 });

    // Clean up this test's own second remote (switch back to local, then
    // remove it) so the "exactly one remote" invariant the rest of this suite
    // relies on (remoteRow/manageButton's suffix-only locators) holds after.
    await openPicker(page);
    await page.getByTestId('daemon-row-local').click();
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac', { timeout: 10_000 });

    // Row selection doesn't necessarily dismiss the picker — force a known
    // (closed) state before reopening it for the removal below.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('daemon-picker')).toHaveCount(0, { timeout: 5_000 });
    await openPicker(page);
    const newRow = daemonRowByHost(page, '58203');
    await newRow.locator('[data-testid$="-manage"]').click();
    await removeMenuRow(page).click();
    await page.getByTestId('daemon-remove-confirm').click();
    await expect(page.getByTestId('daemon-remove-dialog')).toHaveCount(0, { timeout: 5_000 });
    await expect(newRow).toHaveCount(0, { timeout: 5_000 });
    await closePicker(page);
  });

  test('unreachable overlay renders when the daemon connection drops, and switch-to-local recovers', async () => {
    const { page } = app;

    // Manually switch to the remote row added by "completing pairing adds a
    // remote daemon row" earlier in this describe (the auto-switch test above
    // added and removed its own separate remote, cleaning up after itself).
    await openPicker(page);
    await remoteRow(page).click();
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('127', { timeout: 10_000 });

    // Force connState to 'disconnected' by failing the LOCAL daemon's health poll —
    // the real signal DaemonFooterStatus/DaemonGatedShell react to (see file header).
    await page.route(LOCAL_HEALTH_URL, async (route) => {
      await route.abort();
    });

    try {
      await expect(page.getByTestId('daemon-unreachable')).toBeVisible({ timeout: 30_000 });
      const switchLocal = page.getByTestId('daemon-unreachable-switchlocal');
      await expect(switchLocal).toBeVisible();
      await switchLocal.click();

      // Active kind flips to local immediately on click, independent of the poll.
      await expect(page.getByTestId('daemon-unreachable')).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await page.unroute(LOCAL_HEALTH_URL);
    }

    await waitConnected(page, 30_000);
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac');
  });

  // Previously: renaming or removing a NON-active remote row was broken —
  // clicking "Rename…"/"Remove…" inside `DaemonRowManage`'s portalled popover
  // ALSO fired the parent `DaemonRow`'s own `onClick={() => onSwitch(d)}`
  // (React bubbles portal-child clicks through the React tree, not the DOM
  // tree), silently switching the active daemon and remounting the
  // daemon-scoped subtree mid-dialog. Fixed by the product-bug-fix campaign —
  // every `MenuRow` inside `DaemonRowManage`'s popover now calls
  // `e.stopPropagation()` before invoking its handler.
  //
  // FIXED: a SEPARATE bug used to remain even after the stopPropagation fix
  // above — the outer `daemon-picker` Popover (DaemonFooterStatus.tsx) closed
  // itself once the nested `DaemonSmallDialog` (a modal Radix Dialog,
  // rename/remove confirm) dismissed. Root cause was Radix's default
  // modal-Dialog-vs-Popover interaction: dismissing the inner modal Dialog
  // fires a dismiss-time interaction that the outer Popover's dismissable
  // layer treats as an outside interaction. Fixed in `DaemonFooterStatus.tsx`
  // by suppressing the picker Popover's `onOpenChange(false)` while a
  // rename/remove/add dialog is open; explicit Escape/outside-click still
  // closes the picker once no dialog is active.
  test('manage menu rename updates the remote row label', async () => {
    const { page } = app;
    await openPicker(page);
    await manageButton(page).click();
    await renameMenuRow(page).click();

    const dialog = page.getByTestId('daemon-rename-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const input = page.getByTestId('daemon-rename-input');
    await input.fill('E2E Renamed Remote');
    await page.getByTestId('daemon-rename-save').click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    // The row picked up the new label, and the active daemon never switched
    // away from local (no bubble-through remount).
    await expect(remoteRow(page)).toContainText('E2E Renamed Remote', { timeout: 5_000 });
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac');
    await closePicker(page);
  });

  test('manage menu remove confirms and removes the remote row', async () => {
    const { page } = app;
    await openPicker(page);
    await manageButton(page).click();
    await removeMenuRow(page).click();

    const dialog = page.getByTestId('daemon-remove-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('daemon-remove-confirm').click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    await expect(page.getByTestId('daemon-picker-empty')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac');
    await closePicker(page);
  });

  test('ends the suite back on the local daemon', async () => {
    const { page } = app;
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac');
    await expect(page.getByTestId('daemon-footer-trigger').locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
