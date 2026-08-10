/**
 * §daemon-picker — the sidebar footer daemon trigger, its picker menu, the
 * add-remote pairing dialog, and the rename/remove/unreachable surfaces.
 *
 * Spec: docs/plans/2026-07-03-tauri-e2e-test-plan.md #8 (Cluster A, P3 — lowest
 * priority in the wave; scenarios below are deliberately conservative).
 *
 * Source: packages/ui/src/v2/features/daemon/{DaemonSwitcher,DaemonMenuItems,
 * AddRemoteDialog,pairing-steps,pairing-shared,DaemonSmallDialog,DaemonUnreachableBody}
 * plus packages/ui/src/features/daemon/{apply-pairing,pair-daemon,use-daemon-registry,
 * active-daemon-context}. The 2026-08 shell port replaced DaemonFooterStatus/DaemonPicker/
 * DaemonRow with the v2 switcher: the picker is a native DropdownMenu (menu-shaped = native
 * DropdownMenu, ledger rule), the manage ⋯ is a DropdownMenuSub, and the pairing/rename/remove
 * dialogs are stock v2 Dialogs (six slots of `InputOTP` for the code).
 *
 * Testid reference (verified against source):
 *   daemon-footer-trigger        — DaemonSwitcher trigger; ConnDot inside carries
 *                                   aria-label Connected/Connecting…/Unreachable
 *   daemon-footer-trigger-label  — the active daemon's LABEL alone; the trigger also
 *                                   prints the host, and the local host is 127.0.0.1:<port>,
 *                                   so only the label separates local from a remote
 *   daemon-picker                — the menu body (DaemonMenuItems root)
 *   daemon-picker-empty          — "No remote daemons yet…" empty state
 *   daemon-picker-add            — "Add remote daemon…" item
 *   daemon-row-<id>              — one daemon item (id='local' for the synthetic local entry)
 *   daemon-row-<id>-active       — Check icon, only rendered when that row is active
 *   daemon-row-<id>-dot          — wrapper around ConnDot (aria-label carries the status word)
 *   daemon-row-<id>-manage       — ⋯ SubTrigger, remote rows only — the row's SIBLING
 *   daemon-row-<id>-rename / -repair / -remove — items in the manage SubContent
 *   daemon-add-url / daemon-add-verify / daemon-add-continue / daemon-add-back /
 *   daemon-add-cancel / daemon-add-retry / daemon-add-device / daemon-add-confirm /
 *   daemon-pair-code             — AddRemoteDialog (pairing-steps.tsx). There is no
 *                                   `daemon-add-close`: the stock dialog's own X and the
 *                                   footer's Cancel are the two exits.
 *   daemon-dialog-rename / daemon-dialog-remove — DaemonSmallDialog, one per kind
 *   daemon-dialog-input / daemon-dialog-confirm / daemon-dialog-cancel — its shared controls
 *   daemon-unreachable / daemon-unreachable-switchlocal — DaemonUnreachableBody
 *     (rendered inside ConnectionOverlay, portalled to document.body)
 *
 * Ground-truth note on the dispatch's "seed via localStorage" lever: there is no
 * localStorage-backed daemon registry. In browser mode `getHost()` resolves to
 * `FakeHostBridge` (lib/host/fake-adapter.ts), which holds `daemons` in a plain
 * in-memory `Map` with no persistence — a `page.reload()` wipes it. Likewise the
 * "active daemon" singleton (lib/daemon/active-daemon.ts) is a bare in-module
 * variable. So the approach below seeds nothing:
 *   1. A real remote daemon entry is added by driving the actual AddRemoteDialog
 *      pairing flow, with `page.route()` mocking only the `/health` and
 *      `/api/auth/confirm` calls to the fake remote origin (network-level fault
 *      injection, not fabricated React/store state).
 *   2. The unreachable overlay then comes for free: `useConnectionState` polls the
 *      ACTIVE daemon's `/health` (`getActiveDaemon().baseUrl`, not a fixed local port),
 *      and a paired remote is stored as `https://<host>` — which no route in this file
 *      mocks — so the poll fails and `showUnreachableOverlay` raises through the app's
 *      real loop. Aborting the LOCAL health route reproduces it while local is active.
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
 * FIXED BUG (see the "pairing auto-switches…" test below): the auto-switch above
 * used to remount `<AppShell key={target.id}>` synchronously inside
 * `handleConfirm`, destroying the still-open `AddRemoteDialog` before it reached
 * the "done" phase — `AddRemoteDialog.handleConfirm` now defers
 * `registry.switchTo()` until after the dialog's own deferred `onClose`.
 *
 * (A second historical bug — the picker Popover closing itself whenever a nested
 * rename/remove dialog dismissed — died with the Popover. A DropdownMenu closes on
 * item select by design, so the dialogs open over a closed menu and each
 * post-dialog assertion below reopens the picker.)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { waitConnected } from '../helpers/tauri/wait.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const LOCAL_HEALTH_URL = `http://127.0.0.1:${DAEMON_PORT}/health`;

/** Suffix-scoped locators — safe because at most one remote daemon exists at a
 *  time by the point these are used (the auto-switch test below adds and then
 *  removes its own second remote before any other test runs), so there is
 *  never an id-ambiguity to resolve. `renameMenuRow`/`removeMenuRow` are safe
 *  even with 2+ remotes present because Radix only mounts a `SubContent` (and
 *  thus these testids) while that submenu is open, and only one manage submenu
 *  is ever open at a time.
 *
 *  Every `daemon-row-*` testid is a menu item now (DaemonMenuItems.tsx), including
 *  the manage SubTrigger and its three actions, so a row locator has to exclude
 *  them by suffix — the manage trigger is the row's SIBLING, not its child. */
const ROW_KIDS = ':not([data-testid$="-manage"]):not([data-testid$="-rename"])';
const ROW_KIDS_2 = ':not([data-testid$="-repair"]):not([data-testid$="-remove"])';
const DAEMON_ROW = `[role="menuitem"][data-testid^="daemon-row-"]${ROW_KIDS}${ROW_KIDS_2}`;

function remoteRow(page: Page) {
  return page.locator(`${DAEMON_ROW}:not([data-testid="daemon-row-local"])`);
}
function manageButton(page: Page) {
  return page.locator(`[data-testid^="daemon-row-"][data-testid$="-manage"]`);
}
/** The ⋯ SubTrigger is the row's sibling, so it is reached by the row's own id
 *  rather than as a descendant. */
async function openManageMenu(page: Page, row: ReturnType<Page['locator']>): Promise<void> {
  const rowTestId = await row.getAttribute('data-testid');
  await page.getByTestId(`${rowTestId}-manage`).click();
}
function renameMenuRow(page: Page) {
  return page.locator(`[data-testid^="daemon-row-"][data-testid$="-rename"]`);
}
function removeMenuRow(page: Page) {
  return page.locator(`[data-testid^="daemon-row-"][data-testid$="-remove"]`);
}
/** Scopes a remote row by a substring of its displayed `d.host` text (e.g. a
 *  port) — needed only while 2 remotes briefly coexist (the auto-switch test's
 *  own second pairing), where the generic `remoteRow`/`manageButton` helpers
 *  above would be ambiguous. */
function daemonRowByHost(page: Page, hostSubstr: string) {
  return page.locator(DAEMON_ROW).filter({ hasText: hostSubstr });
}
/** The trigger prints label AND host, and the local host is `127.0.0.1:<port>` —
 *  so only the label discriminates local ("This Mac") from a remote ("127"). */
function footerLabel(page: Page) {
  return page.getByTestId('daemon-footer-trigger-label');
}

async function openPicker(page: Page): Promise<void> {
  // After a failed remote health-check (the dead-port "unreachable URL" test),
  // the local connection state can transiently OSCILLATE, flickering the
  // full-screen ConnectionOverlay — a `fixed inset-0 z-[11000]` scrim portaled
  // to body (ConnectionOverlay.tsx) that intercepts pointer events even though
  // the trigger itself is "stable". A one-shot guard races the flicker, so
  // retry the whole open until the scrim is gone and the click actually lands
  // (bounded — replaces the pre-existing 2-min-timeout flake on the test that
  // runs right after the dead-port one).
  // Retry the whole open to ride out a transient ConnectionOverlay scrim that
  // can intercept the click. KNOWN RESIDUAL FLAKE (self-heals on retries:1):
  // after the unreachable-URL test, headless Chromium's socket handling flaps
  // the app's LOCAL /health poll, raising the scrim for a VARIABLE duration
  // (~15s to occasionally >30s). Mocking that test's refusal (see it) reduces
  // the frequency/severity; this 30s retry catches most cases fast; the rare
  // longer scrim is healed by Playwright's retry. It's a headless-networking
  // artifact, NOT a product bug (a real user's local connection is unaffected
  // by verifying a bad remote URL). Every non-post-verify call clicks first-try.
  await expect(async () => {
    // Any OTHER Radix layer left open — a menu closing after an item select, or
    // the zero-session boot picker (see the describe's beforeAll) — owns the
    // page's pointer events and makes this trigger unhittable while it lives.
    await page.keyboard.press('Escape');
    await page.getByTestId('daemon-footer-trigger').click({ timeout: 5_000 });
    await expect(page.getByTestId('daemon-picker')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000, 3_000] });
}

async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('daemon-picker')).toHaveCount(0, { timeout: 5_000 });
}

async function recoverToLocal(page: Page): Promise<void> {
  await expect(page.getByTestId('daemon-unreachable')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('daemon-unreachable-switchlocal').click();
  await expect(page.getByTestId('daemon-unreachable')).toHaveCount(0, { timeout: 5_000 });
  await waitConnected(page, 30_000);
  await expect(footerLabel(page)).toHaveText('This Mac');
}

// Serial in fact, so declared serial: every test here inherits the daemon the
// previous one left active, the pairing tests hand a remote row to the manage
// tests, and the last test asserts the suite ended back on local. Undeclared,
// one broken test ran the remaining four against a wedged app for the full
// per-test budget each — 14m31s in rc.22 for a file that takes 12s green. The
// trade is real: a failure here now skips its followers instead of reporting
// them, so a single red run says less than it used to.
test.describe.configure({ mode: 'serial' });

test.describe('§daemon-picker', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // A project with ZERO sessions is the app's "boot dead-end": ChatSurface's
    // useZeroSessionBootPicker force-opens the "New session in…" menu 1.5s in, and
    // that modal layer swallows the pointer events this suite's footer trigger needs.
    // Seeding one session is what a real user's workspace looks like anyway.
    await createTauriChat(app.page, project.projectId, 'default');
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
      await page.getByTestId('daemon-add-cancel').click();
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
    // Mock the refusal (route.abort) rather than hitting a real dead loopback
    // port. A genuine connection-refused to a dead port perturbs headless
    // Chromium's local networking enough to flap the app's LOCAL /health poll,
    // which raised the full-screen "Reconnecting to daemon" ConnectionOverlay
    // for 30-45s+ afterward and intercepted the NEXT test's clicks (a
    // pre-existing flake). Aborting the request produces the identical
    // "Couldn't reach this URL" verify failure with no real socket churn.
    const deadOrigin = 'http://127.0.0.1:59991';
    await page.route(`${deadOrigin}/**`, (route) => route.abort('connectionrefused'));

    await openPicker(page);
    await page.getByTestId('daemon-picker-add').click();
    await expect(page.getByTestId('daemon-add-url')).toBeVisible();

    await page.getByTestId('daemon-add-url').fill(deadOrigin);
    await page.getByTestId('daemon-add-verify').click();

    await expect(page.getByText(/Couldn.t reach this URL/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    // Continue must not appear for an unreachable URL — Verify/Retry only.
    await expect(page.getByTestId('daemon-add-continue')).toHaveCount(0);

    await page.getByTestId('daemon-add-cancel').click();
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
    // `daemon-pair-code` IS the input: shadcn's InputOTP spreads props onto input-otp's
    // single hidden field, and the six boxes are sibling divs — there is no input inside it.
    await page.getByTestId('daemon-pair-code').click();
    await page.keyboard.type('ABC123');
    await page.getByTestId('daemon-add-device').fill('E2E Remote Device');

    const confirmButton = page.getByTestId('daemon-add-confirm');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // The dialog now closes only after the 800ms deferred onClose (see the
    // auto-switch test below for the fix); either way, it's gone by now.
    await expect(page.getByTestId('daemon-add-url')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('daemon-pair-code')).toHaveCount(0, { timeout: 5_000 });

    await expect(footerLabel(page)).toHaveText('127', { timeout: 10_000 });
    await recoverToLocal(page);

    // The row is added — label is derived from the host
    // ("127.0.0.1:58202".split('.')[0] === "127").
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

    // Establish a known starting state so this test's auto-switch assertion is
    // meaningful, not inherited ambient state.
    await openPicker(page);
    await page.getByTestId('daemon-row-local').click();
    await expect(footerLabel(page)).toHaveText('This Mac', { timeout: 10_000 });
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
    // `daemon-pair-code` IS the input: shadcn's InputOTP spreads props onto input-otp's
    // single hidden field, and the six boxes are sibling divs — there is no input inside it.
    await page.getByTestId('daemon-pair-code').click();
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
    await expect(footerLabel(page)).not.toHaveText('This Mac', { timeout: 10_000 });
    await expect(footerLabel(page)).toHaveText('127', { timeout: 10_000 });

    await recoverToLocal(page);

    // Clean up this test's own second remote so the "exactly one remote"
    // invariant the rest of this suite relies on holds after.
    await openPicker(page);
    const newRow = daemonRowByHost(page, '58203');
    await openManageMenu(page, newRow);
    await removeMenuRow(page).click();
    await page.getByTestId('daemon-dialog-confirm').click();
    await expect(page.getByTestId('daemon-dialog-remove')).toHaveCount(0, { timeout: 5_000 });

    // Choosing a manage action closes the menu (Radix item select), so the row is
    // gone from the DOM either way — reopen to prove the entry itself is gone.
    await openPicker(page);
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
    await expect(footerLabel(page)).toHaveText('127', { timeout: 10_000 });

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
    await expect(footerLabel(page)).toHaveText('This Mac');
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
  // The picker no longer stays open behind these dialogs, and no longer needs to:
  // choosing a manage action is a Radix item select, which closes the menu before
  // `DaemonSwitcher` mounts the dialog as a sibling. The old
  // suppress-`onOpenChange(false)`-while-a-dialog-is-open workaround (and the
  // portal-click bubble-through it guarded) died with the Popover it patched — so
  // each assertion below reads the row from a FRESH open.
  test('manage menu rename updates the remote row label', async () => {
    const { page } = app;
    await openPicker(page);
    await manageButton(page).click();
    await renameMenuRow(page).click();

    const dialog = page.getByTestId('daemon-dialog-rename');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const input = page.getByTestId('daemon-dialog-input');
    await input.fill('E2E Renamed Remote');
    await page.getByTestId('daemon-dialog-confirm').click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    // The row picked up the new label, and the active daemon never switched
    // away from local (choosing a manage action must not select the row).
    await openPicker(page);
    await expect(remoteRow(page)).toContainText('E2E Renamed Remote', { timeout: 5_000 });
    await expect(footerLabel(page)).toHaveText('This Mac');
    await closePicker(page);
  });

  test('manage menu remove confirms and removes the remote row', async () => {
    const { page } = app;
    await openPicker(page);
    await manageButton(page).click();
    await removeMenuRow(page).click();

    const dialog = page.getByTestId('daemon-dialog-remove');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('daemon-dialog-confirm').click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    await openPicker(page);
    await expect(page.getByTestId('daemon-picker-empty')).toBeVisible({ timeout: 5_000 });
    await expect(footerLabel(page)).toHaveText('This Mac');
    await closePicker(page);
  });

  test('ends the suite back on the local daemon', async () => {
    const { page } = app;
    await expect(footerLabel(page)).toHaveText('This Mac');
    await expect(page.getByTestId('daemon-footer-trigger').locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
