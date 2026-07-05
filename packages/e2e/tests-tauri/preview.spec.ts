/**
 * §preview — Sandbox preview tab (Run surface) specs for app-tauri browser mode.
 *
 * Cluster C, spec #22 of docs/plans/2026-07-03-tauri-e2e-test-plan.md.
 *
 * Browser-mode limits (see `.superpowers/sdd/e2e-shared-brief.md` + the plan's "Not
 * testable in browser mode" section): there is no real Tauri webview in Chromium.
 * `host.preview.mount()` resolves through `FakeHostBridge` (packages/ui/src/lib/host/
 * fake-adapter.ts), which returns a working `PreviewHandle` stub — `navigate`/
 * `startInspect`/`startRegionSelect` all resolve without effect, and `capture()`
 * ALWAYS rejects ("preview.capture is not available in browser/dev mode"). That means:
 *   - The daemon-driven lifecycle (stopped → starting → running/failed → stopped) IS
 *     fully testable — it's driven by `LaunchProcessStatus` from the real daemon, not
 *     the webview.
 *   - Toolbar chrome (run/stop/restart, URL bar enable/disable + input normalization,
 *     device toggle, capture-cluster enable/disable, the Inspect button's own local
 *     active/inactive visual) IS testable — these are React-state-driven, not pixels.
 *   - Actual pixels, in-webview navigation, element-pick results, and region-capture
 *     results are NOT testable (`test.skip` + TODO(tauri-native)).
 *   - The capture → annotation-popover flow is NOT reachable at all in browser mode:
 *     `onCaptureClick` only calls `setAnnotationPopoverOpen(true)` inside the `.then()`
 *     of `handle.capture()`, which always rejects here; the `window.__sandboxStore` e2e
 *     seeding hook was intentionally removed (see packages/ui/src/store/sandbox.ts
 *     header comment: "use data-testid instead"). No path exists to open the popover
 *     without a native capture, so its scenarios are `test.skip` + TODO(tauri-native)
 *     rather than faked via store injection.
 *   - The local daemon (this harness) never uses the Cloudflare-tunnel branch
 *     (`resolvePreviewUrl` short-circuits to `http://localhost:{port}` when
 *     `isLocal`), so `preview-tunnel-*` testids are never asserted here.
 *
 * Config seeding: writes `.mainframe/launch.json` directly into the temp project
 * (same mechanism the real daemon route reads — `packages/core/src/server/routes/
 * launch.ts` `GET /api/projects/:id/launch/configs`), independent of any other spec's
 * seeding (each spec/project pair is a fresh temp dir). The "running" describe spawns a
 * real `node -e` HTTP server on a dynamically-allocated free port (delayed via
 * `setTimeout` so the `starting` state is comfortably observable before the port
 * actually opens); the "failed" describe points `runtimeExecutable` at a nonexistent
 * binary so the daemon's `child.once('error')` (ENOENT) path fires quickly.
 *
 * Testid reference (verified against source):
 *   surface-rail-run              — toggles the Run surface on
 *   run-surface / run-surface-picker (empty state)
 *   run-picker-launch-<config>    — a launch-config row in the empty-state picker
 *   preview-toolbar               — toolbar root
 *   preview-run-start / preview-run-stop / preview-run-restart
 *   preview-url-input / preview-url-reload / preview-url-open-browser / preview-url-clear-cache
 *   preview-device-toggle / preview-device-desktop / preview-device-mobile
 *   preview-capture-cluster / preview-toolbar-inspect / preview-toolbar-capture / preview-toolbar-region
 *   preview-inspect-active-indicator — "CLICK AN ELEMENT" badge, driven purely by local inspectActive state
 *   preview-body-stopped / preview-body-cta / preview-body-starting / preview-body-running / preview-body-failed
 *   preview-annotation-popover / preview-annotation-list / preview-annotation-item-<id> /
 *     preview-annotation-input-<id> / preview-annotation-cancel / preview-annotation-submit
 *     (all TODO(tauri-native) skipped — unreachable without a native capture)
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'net';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

/** Grab an OS-assigned free TCP port so the spawned preview server never collides
 *  with the daemon (31416), vite preview (4317), or another spec's server. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('getFreePort: no address')));
      }
    });
  });
}

/** Write a single-configuration `.mainframe/launch.json` into the project. */
function writeLaunchConfig(
  projectPath: string,
  config: { name: string; runtimeExecutable: string; runtimeArgs: string[]; port: number | null },
): void {
  mkdirSync(path.join(projectPath, '.mainframe'), { recursive: true });
  writeFileSync(
    path.join(projectPath, '.mainframe', 'launch.json'),
    JSON.stringify({ version: '1.0', configurations: [{ ...config, preview: true }] }, null, 2),
  );
}

// ─── §preview — running lifecycle + toolbar chrome ────────────────────────────

test.describe('§preview — running lifecycle', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let port: number;
  const CONFIG_NAME = 'webserver';

  test.beforeAll(async () => {
    port = await getFreePort();
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // Delay `listen()` by 3s so the daemon's port-poll (1s interval) observes several
    // "not listening yet" attempts — keeps the UI in `starting` long enough to assert
    // against, rather than flashing through it inside a single event-loop tick.
    writeLaunchConfig(project.projectPath, {
      name: CONFIG_NAME,
      runtimeExecutable: 'node',
      runtimeArgs: [
        '-e',
        `setTimeout(()=>{require('http').createServer((req,res)=>{res.end('ok')}).listen(${port})},3000)`,
      ],
      port,
    });
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('Run surface picker lists the preview config', async () => {
    const { page } = app;
    await page.getByTestId('surface-rail-run').click();
    await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('run-surface-picker')).toBeVisible();
    const row = page.getByTestId(`run-picker-launch-${CONFIG_NAME}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(CONFIG_NAME);
    await expect(row).toContainText('preview');
  });

  test('starting the config shows the starting body and keeps toolbar controls locked', async () => {
    const { page } = app;
    await page.getByTestId(`run-picker-launch-${CONFIG_NAME}`).click();

    await expect(page.getByTestId('preview-toolbar')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('preview-body-starting')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('preview-body-starting')).toContainText(`Waiting for localhost:${port}`);

    // Toolbar controls stay locked while not running.
    await expect(page.getByTestId('preview-url-input')).toBeDisabled();
    await expect(page.getByTestId('preview-url-reload')).toBeDisabled();
    await expect(page.getByTestId('preview-url-open-browser')).toBeDisabled();
    await expect(page.getByTestId('preview-url-clear-cache')).toBeDisabled();
    await expect(page.getByTestId('preview-capture-cluster')).toHaveClass(/opacity-40/);
    await expect(page.getByTestId('preview-capture-cluster')).toHaveClass(/pointer-events-none/);
  });

  test('reaches the running state and unlocks the toolbar', async () => {
    const { page } = app;
    await expect(page.getByTestId('preview-body-running')).toBeVisible({ timeout: 30_000 });

    // Run control swaps from "Run" to "Stop"/"Restart".
    await expect(page.getByTestId('preview-run-stop')).toBeVisible();
    await expect(page.getByTestId('preview-run-restart')).toBeVisible();
    await expect(page.getByTestId('preview-run-start')).toHaveCount(0);

    // URL bar reflects the resolved local URL and unlocks.
    await expect(page.getByTestId('preview-url-input')).toBeEnabled();
    await expect(page.getByTestId('preview-url-input')).toHaveValue(`http://localhost:${port}`);
    await expect(page.getByTestId('preview-url-reload')).toBeEnabled();
    await expect(page.getByTestId('preview-url-open-browser')).toBeEnabled();
    await expect(page.getByTestId('preview-url-clear-cache')).toBeEnabled();

    // Capture cluster unlocks.
    await expect(page.getByTestId('preview-capture-cluster')).not.toHaveClass(/opacity-40/);
    await expect(page.getByTestId('preview-capture-cluster')).not.toHaveClass(/pointer-events-none/);
  });

  test('URL bar normalizes valid input and flags invalid input', async () => {
    const { page } = app;
    const input = page.getByTestId('preview-url-input');

    // Valid: schemeless host:port/path gets an http:// scheme + URL-normalized.
    await input.fill('localhost:9999/foo');
    await input.press('Enter');
    await expect(input).toHaveValue('http://localhost:9999/foo');
    await expect(input).not.toHaveClass(/ring-destructive/);

    // Invalid: a malformed IPv6-bracket host reliably fails `new URL()` parsing.
    // CORRECTION (verified live against the real Chromium runtime this spec
    // actually runs in, not Node): a plain space-containing host like
    // "not a valid host" does NOT throw here — Chromium's URL parser silently
    // percent-encodes it into "http://not%20a%20valid%20host/" instead of
    // rejecting it (confirmed via a live `new URL()` probe in this exact
    // browser). `[invalid` (an unterminated IPv6 literal) throws consistently
    // in both Node and Chromium — a genuinely unparseable host.
    await input.fill('[invalid');
    await input.press('Enter');
    await expect(input).toHaveClass(/ring-destructive/);

    // Escape reverts the draft and clears the invalid flag.
    await input.press('Escape');
    await expect(input).toHaveValue(`http://localhost:9999/foo`);
    await expect(input).not.toHaveClass(/ring-destructive/);
  });

  test('device toggle switches between the desktop and mobile frame', async () => {
    const { page } = app;
    const body = page.getByTestId('preview-body-running');
    // The mobile phone-frame is a fixed 230×420 wrapper (`w-[230px] h-[420px]`);
    // the desktop frame has no such element — presence of this node is the
    // observable signal that the frame kind switched.
    const mobileFrame = body.locator('div[class*="230px"]');

    await expect(mobileFrame).toHaveCount(0);
    await expect(page.getByTestId('preview-device-desktop')).toHaveClass(/bg-background/);

    await page.getByTestId('preview-device-mobile').click();
    await expect(page.getByTestId('preview-device-mobile')).toHaveClass(/bg-background/);
    await expect(mobileFrame).toBeVisible();

    await page.getByTestId('preview-device-desktop').click();
    await expect(page.getByTestId('preview-device-desktop')).toHaveClass(/bg-background/);
    await expect(mobileFrame).toHaveCount(0);
  });

  test('Inspect button toggles its own active indicator (local state, no native pick)', async () => {
    const { page } = app;
    // PreviewBodyState computes the "CLICK AN ELEMENT" badge purely from the local
    // `inspectActive` boolean (packages/ui/src/features/preview/PreviewBodyState.tsx) —
    // toggling it is toolbar chrome, not a native inspect result. Actually receiving
    // a picked element (`InspectResult`) requires the native webview — see the
    // TODO(tauri-native) test below.
    const inspectBtn = page.getByTestId('preview-toolbar-inspect');
    await expect(page.getByTestId('preview-inspect-active-indicator')).toHaveCount(0);

    await inspectBtn.click();
    await expect(inspectBtn).toHaveClass(/bg-mf-chip/);
    await expect(page.getByTestId('preview-inspect-active-indicator')).toBeVisible();
    await expect(page.getByTestId('preview-inspect-active-indicator')).toContainText('CLICK AN ELEMENT');

    await inspectBtn.click();
    await expect(inspectBtn).not.toHaveClass(/bg-mf-chip/);
    await expect(page.getByTestId('preview-inspect-active-indicator')).toHaveCount(0);
  });

  test('Stop returns the body to the stopped CTA state and re-locks the toolbar', async () => {
    const { page } = app;
    await page.getByTestId('preview-run-stop').click();

    await expect(page.getByTestId('preview-body-stopped')).toBeVisible({ timeout: 10_000 });
    const cta = page.getByTestId('preview-body-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(`Run ${CONFIG_NAME}`);
    await expect(cta).toContainText(`localhost:${port}`);

    await expect(page.getByTestId('preview-url-input')).toBeDisabled();
    await expect(page.getByTestId('preview-capture-cluster')).toHaveClass(/opacity-40/);
  });

  test('clicking the stopped-body CTA restarts the config back to running', async () => {
    const { page } = app;
    await page.getByTestId('preview-body-cta').click();

    await expect(page.getByTestId('preview-body-starting')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('preview-body-running')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('preview-run-stop')).toBeVisible();
  });

  // ─── Native-webview-dependent scenarios (no real Tauri webview in Chromium) ───

  test('capturing a screenshot opens the annotation popover (needs native webview.capture)', async () => {
    test.skip(
      true,
      'TODO(tauri-native): host.preview.mount().capture() always rejects under FakeHostBridge ' +
        '(browser/dev mode), and onCaptureClick only opens the popover inside the resolved .then() ' +
        '— so the popover is structurally unreachable here. The window.__sandboxStore e2e seeding ' +
        'hook was intentionally removed (packages/ui/src/store/sandbox.ts), so there is no way to ' +
        'inject a pendingCapture to open it without native capture support.',
    );
  });

  test('region-capture completes and opens the annotation popover (needs native region-select result)', async () => {
    test.skip(
      true,
      'TODO(tauri-native): handle.startRegionSelect() resolves in browser mode but handle.onRegionSelect ' +
        'never fires (no native completion event) — regionSelectActive gets stuck true with no reachable ' +
        'follow-up UI to assert. Real region selection + capture needs the native webview.',
    );
  });

  test('clicking an inspected element in the webview reports a pick result', async () => {
    test.skip(
      true,
      'TODO(tauri-native): InspectResult only arrives via handle.onInspect(), which requires a real ' +
        'native webview delivering pixel-level pick events. Browser mode has no such source.',
    );
  });

  test('the preview webview renders the live page and reflects in-webview navigation', async () => {
    test.skip(
      true,
      'TODO(tauri-native): pixels + two-way URL sync (handle.onNavigate) require a real native webview; ' +
        'FakeHostBridge.preview.mount() has no backing surface to render or navigate.',
    );
  });
});

// ─── §preview — failed config ──────────────────────────────────────────────────

test.describe('§preview — failed config', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  const CONFIG_NAME = 'broken';

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    writeLaunchConfig(project.projectPath, {
      name: CONFIG_NAME,
      runtimeExecutable: 'mf-e2e-nonexistent-binary',
      runtimeArgs: [],
      port: null,
    });
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  // Previously: `preview-body-failed` never mounted — the same
  // unguarded-stale-REST-overwrite bug fixed in run-surface.spec.ts's "Stop
  // reverts the toolbar to Start for sleep-long" (`use-launch-configs.ts`'s
  // `GET /launch/status` fetch had no guard against a newer WS
  // `launch.status` update superseding it), triggered here by
  // `RunTabStrip` mounting its own fresh `useLaunchConfigs` instance right as
  // the daemon's async spawn-error (ENOENT) detection was racing to
  // complete. Fixed by the same `reconcileFetchedStatus` stale-response guard
  // in the product-bug-fix campaign.
  test('a config with a nonexistent executable reaches the failed state', async () => {
    const { page } = app;
    await page.getByTestId('surface-rail-run').click();
    await expect(page.getByTestId('run-surface')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`run-picker-launch-${CONFIG_NAME}`).click();

    await expect(page.getByTestId('preview-body-failed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('preview-body-failed')).toContainText('Failed to start');

    // The Run control resets to "Run" (stopped/failed both count as "stopped" for the control).
    await expect(page.getByTestId('preview-run-start')).toBeVisible();
  });
});
