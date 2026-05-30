import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, openSync, closeSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the built Electron main entry point
const APP_MAIN = path.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

// Core daemon entry — run with plain Node.js to avoid native module ABI mismatch
// (better-sqlite3 is compiled for system Node.js, not Electron's bundled runtime).
const DAEMON_ENTRY = path.resolve(__dirname, '../../../packages/core/dist/index.js');

// Dedicated e2e port (NOT the dev default 31415) so the harness never collides with — and
// silently runs against — a developer's running Mainframe. The renderer is built to talk to
// this port (VITE_DAEMON_HTTP_PORT/WS_PORT); see `pnpm build:app` in this package.
export const DAEMON_PORT = process.env['MF_E2E_DAEMON_PORT'] ?? '31416';
const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

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

export async function launchApp(): Promise<AppFixture> {
  // Refuse to run if the port is already taken — prevents pollution of a real daemon.
  await assertPortFree();

  // Isolated data dir — never touches ~/.mainframe
  const testDataDir = mkdtempSync(path.join(tmpdir(), 'mf-e2e-data-'));

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
    env: { ...process.env, MAINFRAME_DATA_DIR: testDataDir, DAEMON_PORT },
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
      args: [APP_MAIN],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        MAINFRAME_DATA_DIR: testDataDir,
        DAEMON_PORT, // main-process helpers (idle-reporter) target the test daemon
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Wait until the renderer's WebSocket connects and the status bar says "Connected"
    await page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });

    return { app, page, testDataDir, daemon };
  } catch (err) {
    await app?.close().catch(() => {}); /* best-effort cleanup on launch failure */
    daemon.kill('SIGKILL');
    throw err;
  }
}

export async function closeApp(fixture: AppFixture): Promise<void> {
  await fixture.app.close();

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
