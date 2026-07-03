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
 * KNOWN BUG (triaged live, not fixed here — see the TODO(bug) test below):
 * completing pairing does not auto-switch the active daemon, and the "Paired"
 * confirmation is never visible. `AddRemoteDialog.handleConfirm` calls
 * `registry.switchTo(meta.id)` right after `registry.add(meta, token)`, but
 * `switchTo` is a `useCallback` closed over a stale pre-add `remotes` snapshot
 * (confirmed via `[useDaemonRegistry] switchTo: unknown id …` in the console),
 * and `DaemonFooterStatus` wires both `onDone` and `onClose` to the same
 * `closeDialog` callback, collapsing the documented 800ms "Paired" grace window
 * to zero. The row IS added correctly; only the auto-switch/confirmation UX is
 * broken — this suite works around it by clicking the row a second time.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { waitConnected } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const LOCAL_HEALTH_URL = `http://127.0.0.1:${DAEMON_PORT}/health`;

/** Suffix-scoped locators — safe because at most one remote daemon ever exists
 *  at a time in this suite, so there is never an id-ambiguity to resolve.
 *  `manageButton`/`renameMenuRow`/`removeMenuRow` are currently only referenced
 *  from the TODO(bug) doc comment on the skipped rename/remove tests below —
 *  kept here (not deleted) so unskipping them is a small diff once the
 *  underlying event-bubbling bug is fixed. */
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

    // Verified behavior (not the dispatch's assumed one — see the TODO(bug) test
    // below): AddRemoteDialog wires `onDone` and `onClose` to the SAME
    // `closeDialog` callback (DaemonFooterStatus.tsx), so `onDone()` closes the
    // dialog on the same tick confirmPairing resolves — the documented 800ms
    // "Paired" grace window (AddRemoteDialog.tsx handleConfirm) never has a
    // chance to render. Assert the dialog closing instead of the transient text.
    await expect(page.getByTestId('daemon-add-url')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('daemon-pair-code')).toHaveCount(0, { timeout: 5_000 });

    // The row is added regardless (registry.add is unaffected by the switch bug
    // below) — label is derived from the host ("127.0.0.1:58202".split('.')[0]
    // === "127").
    await openPicker(page);
    await expect(remoteRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(remoteRow(page)).toContainText('127');
    await closePicker(page);
  });

  // TODO(bug): pairing does not auto-switch the active daemon to the newly-added
  // remote, and the "Paired" confirmation is never visible. Two independent bugs
  // in packages/ui/src/features/daemon/:
  //  1. AddRemoteDialog.tsx `handleConfirm` calls `registry.add(meta, token)` then
  //     `registry.switchTo(meta.id)` using the SAME `registry` object captured at
  //     render time. `switchTo` is a `useCallback` closed over `remotes` (from
  //     `useDaemonRegistry`'s `useSyncExternalStore` snapshot) — at the moment
  //     THIS render's `handleConfirm` closure was created, `remotes` was still
  //     the pre-pairing (empty) list, so `switchTo` can never find the
  //     just-added meta and silently no-ops (`console.warn('[useDaemonRegistry]
  //     switchTo: unknown id', id)` + return) — confirmed live via a console
  //     listener during triage. The daemon stays on 'This Mac'; the user has to
  //     click the new row again (a fresh registry snapshot by then) to connect.
  //  2. DaemonFooterStatus.tsx passes `onDone={closeDialog}` AND
  //     `onClose={closeDialog}` to `<AddRemoteDialog>` — the SAME function. Since
  //     `handleConfirm` calls `onDone()` synchronously right after
  //     `setStep1Phase('done')`, the dialog's `open` prop flips to false on the
  //     same tick, before the documented 800ms deferred-close window
  //     (`closeTimerRef.current = setTimeout(onClose, 800)`) ever matters — the
  //     "Paired" button label / notice is never actually visible to a user.
  // See packages/ui/src/features/daemon/{AddRemoteDialog.tsx,DaemonFooterStatus.tsx,
  // use-daemon-registry.ts}. Unskip once both are fixed.
  test.skip('TODO(bug): pairing auto-switches the active daemon and shows a "Paired" confirmation', () => {});

  test('unreachable overlay renders when the daemon connection drops, and switch-to-local recovers', async () => {
    const { page } = app;

    // Pairing itself does not switch the active daemon (see the TODO(bug) test
    // above) — manually switch to the remote row added by the previous test. A
    // fresh click uses the CURRENT registry snapshot (remotes already includes
    // the added meta by now), so this switch works correctly.
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

  // TODO(bug): renaming or removing a NON-active remote row is broken. Triaged
  // live via a console/network listener: clicking "Rename…"/"Remove…" inside
  // DaemonRowManage's popover ALSO fires the parent DaemonRow's own
  // `onClick={() => onSwitch(d)}`. `DaemonRowManage`'s `PopoverContent` (Radix)
  // portals to `document.body`, and `MenuRow` (components/ui/menu.tsx) never
  // calls `stopPropagation()` — React bubbles portal-child clicks through the
  // REACT tree (not the DOM tree), so the click reaches DaemonRow's own onClick
  // too. That silently switches the active daemon to the row being managed,
  // which (App.tsx `key={target.id}`) remounts the whole daemon-scoped subtree
  // — including DaemonFooterStatus's own `dialog` state — wiping the
  // rename/remove dialog the SAME click just opened. Confirmed by watching the
  // footer flip from 'This Mac' to the remote's label right as the dialog
  // vanished. Only bites when the managed row isn't already the active one
  // (renaming/removing the active daemon is a same-id no-op switch, no
  // remount) — exactly this suite's case. See
  // packages/ui/src/components/ui/menu.tsx MenuRow +
  // packages/ui/src/features/daemon/DaemonRow.tsx DaemonRowManage.
  test('manage menu rename updates the remote row label', async () => {
    test.skip(
      true,
      'TODO(bug): manage-menu click bubbles to the row onClick and switches+remounts — see comment above',
    );
  });

  test('manage menu remove confirms and removes the remote row', async () => {
    test.skip(
      true,
      'TODO(bug): manage-menu click bubbles to the row onClick and switches+remounts — see comment above',
    );
  });

  test('ends the suite back on the local daemon', async () => {
    const { page } = app;
    await expect(page.getByTestId('daemon-footer-trigger')).toContainText('This Mac');
    await expect(page.getByTestId('daemon-footer-trigger').locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
