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

const DAEMON_PORT = '31415';
const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

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
  // Isolated data dir — never touches ~/.mainframe
  const testDataDir = mkdtempSync(path.join(tmpdir(), 'mf-e2e-data-'));

  // Start daemon as a plain Node.js process.
  // This avoids the native module ABI mismatch that occurs when daemon.cjs runs
  // inside Electron's utility process (Electron has its own Node.js runtime).
  // Redirect daemon output to a file — keeps test output readable.
  // Inspect testDataDir/daemon.log if a test fails and you need daemon logs.
  const daemonLogFd = openSync(path.join(testDataDir, 'daemon.log'), 'w');
  const daemon = spawn('node', [DAEMON_ENTRY], {
    env: { ...process.env, MAINFRAME_DATA_DIR: testDataDir, PORT: DAEMON_PORT },
    stdio: ['ignore', daemonLogFd, daemonLogFd],
  });
  closeSync(daemonLogFd); // parent no longer needs the fd; child keeps it open

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
  const app = await electron.launch({
    args: [APP_MAIN],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MAINFRAME_DATA_DIR: testDataDir,
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
}

export async function closeApp(fixture: AppFixture): Promise<void> {
  await fixture.app.close();
  fixture.daemon.kill();
  rmSync(fixture.testDataDir, { recursive: true, force: true });
}
