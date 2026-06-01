import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawn, execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, openSync, closeSync, mkdirSync, cpSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the built Electron main entry point
const APP_MAIN = path.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

// Electron's setuid sandbox can't initialize on CI runners (sandboxed/non-root or missing
// chrome-sandbox perms) → `Process failed to launch`. Disable it under CI; harmless locally.
export const E2E_ELECTRON_EXTRA_ARGS = process.env['CI'] ? ['--no-sandbox'] : [];
const RENDERER_INDEX_HTML = path.resolve(__dirname, '../../../packages/desktop/out/renderer/index.html');
const PROD_DAEMON_PORT = '31415';

// Core daemon entry — run with plain Node.js to avoid native module ABI mismatch
// (better-sqlite3 is compiled for system Node.js, not Electron's bundled runtime).
const DAEMON_ENTRY = path.resolve(__dirname, '../../../packages/core/dist/index.js');

// Dedicated e2e port (NOT the dev default 31415) so the harness never collides with — and
// silently runs against — a developer's running Mainframe. The renderer is built to talk to
// this port (VITE_DAEMON_HTTP_PORT/WS_PORT); see `pnpm build:app` in this package.
export const DAEMON_PORT = process.env['MF_E2E_DAEMON_PORT'] ?? '31416';
const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

const E2E_MODE = process.env['E2E_MODE'];
const RECORDINGS_DIR = path.resolve(__dirname, '../fixtures/recordings');
const MOCK_PLUGIN_DIR = path.resolve(__dirname, '../plugins/mock-cli');
const ESBUILD_BIN = path.resolve(__dirname, '../../../node_modules/.bin/esbuild');

function buildMockPlugin(): void {
  execFileSync(
    ESBUILD_BIN,
    [
      'plugins/mock-cli/src/index.ts',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--outfile=plugins/mock-cli/index.js',
    ],
    { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' },
  );
}

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

/**
 * Fail fast if something is already answering on our port. Without this, a foreign daemon
 * (e.g. a dev Mainframe) would absorb the bind and the suite would run against — and pollute —
 * real data. See git history: this exact footgun registered junk projects in a real instance.
 */
async function assertPortFree(): Promise<void> {
  let reachable = false;
  try {
    const res = await fetch(`${DAEMON_BASE}/api/projects`, { signal: AbortSignal.timeout(1_000) });
    reachable = res.ok;
  } catch {
    reachable = false; /* connection refused / timeout = port is free, which is what we want */
  }
  if (reachable) {
    throw new Error(
      `A daemon is already answering on port ${DAEMON_PORT}. The e2e harness needs an exclusive ` +
        `port so it never runs against (and pollutes) a real instance. Free it first:\n` +
        `  lsof -ti :${DAEMON_PORT} | xargs kill\n` +
        `or run with a different port: MF_E2E_DAEMON_PORT=<port> (rebuild the app to match).`,
    );
  }
}

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
  testDataDir: string;
  daemon: ChildProcess;
}

async function waitForDaemon(maxMs = 10_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${DAEMON_BASE}/api/projects`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Daemon did not become ready within ${maxMs}ms`);
}

export async function launchApp(opts?: { recordingKey?: string; skipTutorial?: boolean }): Promise<AppFixture> {
  // Kill any orphaned e2e Electron from a previously-failed run (they hold the shared 9222 debug
  // port and would hang this launch). Serial suite, so this only ever targets zombies.
  reapStrayE2eElectrons();
  // Refuse to run if the built renderer points at the prod daemon, or if something already answers
  // on our port — both would route the test app at real data.
  assertRendererBuiltForTestPort();
  await assertPortFree();

  // Isolated data dir — never touches ~/.mainframe
  const testDataDir = mkdtempSync(path.join(tmpdir(), 'mf-e2e-data-'));

  // E2E record/replay wiring. In mock mode, build + symlink the external plugin into the isolated
  // data dir's plugins/ (the daemon scans getDataDir()/plugins). In record mode, the real claude
  // adapter is wrapped in-daemon. Both modes get the recordings dir + optional stable key.
  const e2eEnv: Record<string, string> = {};
  if (E2E_MODE) {
    e2eEnv['E2E_MODE'] = E2E_MODE;
    e2eEnv['E2E_RECORDINGS_DIR'] = RECORDINGS_DIR;
    if (opts?.recordingKey) e2eEnv['E2E_RECORDING_KEY'] = opts.recordingKey;
  }
  if (E2E_MODE === 'mock') {
    buildMockPlugin();
    const pluginsDir = path.join(testDataDir, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    // Copy (not symlink) the built plugin into the data dir: the daemon's plugin loader skips
    // symlinked entries (readdirSync withFileTypes reports a symlinked dir as isDirectory()===false),
    // so a symlink would never be discovered. A real directory copy is loaded.
    cpSync(MOCK_PLUGIN_DIR, path.join(pluginsDir, 'mock-cli'), { recursive: true });
  }

  // Start daemon as a plain Node.js process.
  // This avoids the native module ABI mismatch that occurs when daemon.cjs runs
  // inside Electron's utility process (Electron has its own Node.js runtime).
  // Redirect daemon output to a file — keeps test output readable.
  // Inspect testDataDir/daemon.log if a test fails and you need daemon logs.
  const daemonLogFd = openSync(path.join(testDataDir, 'daemon.log'), 'w');
  const daemon = spawn('node', [DAEMON_ENTRY], {
    // The daemon reads DAEMON_PORT (see core/src/config.ts), NOT PORT. The old harness passed
    // PORT, so the spawned daemon silently fell back to its default 31415 — which is why it only
    // ever "worked" when 31415 happened to be free (CI) and collided with a dev instance locally.
    env: { ...process.env, MAINFRAME_DATA_DIR: testDataDir, DAEMON_PORT, ...e2eEnv },
    stdio: ['ignore', daemonLogFd, daemonLogFd],
  });
  closeSync(daemonLogFd); // parent no longer needs the fd; child keeps it open

  // If any post-spawn step throws, kill the daemon before rethrowing so a failed beforeAll never
  // leaks a process holding the port (which would cascade-fail every later spec via assertPortFree).
  let app: ElectronApplication | undefined;
  try {
    // Wait until the daemon's HTTP server is accepting connections
    await waitForDaemon();

    // Set Haiku as the default model — tests run fast and cheap.
    // Tests that exercise model-switching override this per-chat via chat.updateConfig.
    await fetch(`${DAEMON_BASE}/api/settings/providers/claude`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'claude-haiku-4-5-20251001' }),
    });

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

  // Wait for the daemon to fully exit so the next launchApp() doesn't connect
  // to a stale process still holding the port.
  await new Promise<void>((resolve) => {
    if (fixture.daemon.exitCode !== null) {
      resolve();
      return;
    }
    fixture.daemon.on('exit', () => resolve());
    fixture.daemon.kill();
    // Safety timeout — don't block forever if SIGTERM is ignored
    setTimeout(() => {
      fixture.daemon.kill('SIGKILL');
      resolve();
    }, 3_000);
  });

  rmSync(fixture.testDataDir, { recursive: true, force: true });
}
