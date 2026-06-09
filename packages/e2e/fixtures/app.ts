import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DAEMON_PORT, PROD_DAEMON_PORT, startDaemon, stopDaemon, type DaemonHandle } from './daemon.js';

export { DAEMON_PORT } from './daemon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the built Electron main entry point
const APP_MAIN = path.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

// Electron's setuid sandbox can't initialize on CI runners (sandboxed/non-root or missing
// chrome-sandbox perms) → `Process failed to launch`. Disable it under CI; harmless locally.
export const E2E_ELECTRON_EXTRA_ARGS = process.env['CI'] ? ['--no-sandbox'] : [];
const RENDERER_INDEX_HTML = path.resolve(__dirname, '../../../packages/desktop/out/renderer/index.html');

/**
 * Fail fast if the built renderer targets the prod daemon port instead of the e2e port.
 *
 * The renderer's daemon port is baked at build time (VITE_DAEMON_HTTP_PORT/WS_PORT + the CSP
 * connect-src). `build:app` bakes DAEMON_PORT (31416), but a plain `pnpm build` re-bakes the
 * default 31415 — and the spawned Electron would then connect to a running prod daemon and create
 * projects/chats in real data. assertPortFree only guards the daemon bind, not the renderer target,
 * so this is the second half of that guard. (This incident happened once — see git history.)
 */
function assertRendererBuiltForTestPort(): void {
  let html: string;
  try {
    html = readFileSync(RENDERER_INDEX_HTML, 'utf8');
  } catch {
    throw new Error(
      `Built renderer not found at ${RENDERER_INDEX_HTML}. Run \`pnpm --filter @qlan-ro/mainframe-e2e build:app\` first.`,
    );
  }
  const targetsTestPort = html.includes(`:${DAEMON_PORT}`);
  const targetsProd = DAEMON_PORT !== PROD_DAEMON_PORT && html.includes(`:${PROD_DAEMON_PORT}`);
  if (!targetsTestPort || targetsProd) {
    throw new Error(
      `The built renderer does not target the e2e daemon port ${DAEMON_PORT} (found prod ${PROD_DAEMON_PORT}). ` +
        `A plain \`pnpm build\` re-bakes the prod port and would point the test app at a real daemon. ` +
        `Rebuild with \`pnpm --filter @qlan-ro/mainframe-e2e build:app\` before running e2e.`,
    );
  }
}

/**
 * Reap leftover e2e Electron processes before launching.
 *
 * The app enables the Chrome DevTools port (9222) in NODE_ENV=development — which e2e uses — so
 * every e2e Electron binds 9222. If a run's beforeAll fails, its Electron can be orphaned still
 * holding 9222, and the *next* launch then hangs (electron.launch never gets a window) → its
 * beforeAll times out → another orphan, cascading. The suite is serial (workers:1), so any live
 * e2e Electron at launch time is a zombie and safe to kill. Scoped to the `mf-e2e-data-` temp
 * profile prefix (which only this harness creates), so it never touches a real Mainframe instance.
 */
function reapStrayE2eElectrons(): void {
  try {
    execFileSync('pkill', ['-9', '-f', 'mf-e2e-data-'], { stdio: 'ignore' });
  } catch {
    // pkill exits non-zero when nothing matched — the normal, healthy case. /* expected */
  }
}

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
  testDataDir: string;
  daemon: ChildProcess;
}

export async function launchApp(opts?: { recordingKey?: string; skipTutorial?: boolean }): Promise<AppFixture> {
  // Kill any orphaned e2e Electron from a previously-failed run (they hold the shared 9222 debug
  // port and would hang this launch). Serial suite, so this only ever targets zombies.
  reapStrayE2eElectrons();
  // Refuse to run if the built renderer points at the prod daemon, or if something already answers
  // on our port — both would route the test app at real data.
  assertRendererBuiltForTestPort();

  // Start the daemon (includes assertPortFree, data-dir creation, spawn, waitForDaemon, Haiku PUT).
  const handle: DaemonHandle = await startDaemon({ recordingKey: opts?.recordingKey });
  const { daemon, testDataDir } = handle;

  // If any post-spawn step throws, kill the daemon before rethrowing so a failed beforeAll never
  // leaks a process holding the port (which would cascade-fail every later spec via assertPortFree).
  let app: ElectronApplication | undefined;
  try {
    // Launch Electron in development mode so it skips its own daemon startup.
    // Both the renderer and the daemon share MAINFRAME_DATA_DIR for a consistent view.
    app = await electron.launch({
      // Isolate Electron's Chromium profile (localStorage/zustand-persist for zone layout,
      // tutorial state, etc.) per launch. Without this it lives in the shared default userData
      // dir and bleeds across runs — e.g. a minimized zone in one spec hides controls in the next.
      args: [APP_MAIN, ...E2E_ELECTRON_EXTRA_ARGS, `--user-data-dir=${path.join(testDataDir, 'electron-profile')}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        MAINFRAME_DATA_DIR: testDataDir,
        DAEMON_PORT, // main-process helpers (idle-reporter) target the test daemon
        MF_E2E: '1', // tells the app to skip the fixed 9222 DevTools port (collides across launches)
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Wait until the renderer's WebSocket connects and the status bar says "Connected"
    await page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });

    // Suppress the onboarding tutorial for every spec except the one that tests it. With a fresh
    // Chromium profile the tutorial defaults to step 1 and — once a project + chat exist — sticks
    // on step 3 ("Chat with your agent"), anchored over the composer. That overlay can sit on top
    // of UI that opens above the composer (e.g. the worktree popover tabs) and intercept clicks.
    // Mark the persisted store complete + reload so TutorialOverlay never renders.
    if (opts?.skipTutorial !== false) {
      await page.evaluate(() =>
        localStorage.setItem('mf:tutorial', JSON.stringify({ state: { completed: true, step: 4 }, version: 0 })),
      );
      await page.reload();
      await page
        .locator('[data-testid="connection-status"]')
        .getByText('Connected', { exact: true })
        .waitFor({ timeout: 15_000 });
    }

    return { app, page, testDataDir, daemon };
  } catch (err) {
    await app?.close().catch(() => {}); /* best-effort cleanup on launch failure */
    daemon.kill('SIGKILL');
    throw err;
  }
}

export async function closeApp(fixture: AppFixture | undefined): Promise<void> {
  // A beforeAll that threw (e.g. port already busy) leaves fixture undefined; afterAll still runs.
  if (!fixture) return;

  // Closing Electron can throw/hang under xvfb. Never let that skip the daemon kill below —
  // a surviving daemon holds port 31416 and makes every subsequent launchApp() fail.
  try {
    await fixture.app?.close();
  } catch (err) {
    console.warn('[e2e] app.close() during teardown failed; killing daemon anyway:', err);
  }

  await stopDaemon({ daemon: fixture.daemon, testDataDir: fixture.testDataDir });
}
