import { chromium, type Browser, type Page, request } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startDaemon, stopDaemon, DAEMON_PORT, type DaemonHandle } from './daemon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_TAURI_DIR = path.resolve(__dirname, '../../../packages/app-tauri');
const DIST_ASSETS = path.join(APP_TAURI_DIR, 'dist', 'assets');
const PREVIEW_PORT = Number(process.env['MF_E2E_PREVIEW_PORT'] ?? 4317);
const PREVIEW_BASE = `http://127.0.0.1:${PREVIEW_PORT}`;
const PNPM = 'pnpm';

export interface TauriAppFixture {
  browser: Browser;
  page: Page;
  preview: ChildProcess;
  daemonHandle: DaemonHandle;
}

/** Fail fast if the built JS bundle doesn't bake the e2e daemon port.
 *  VITE_DAEMON_PORT is inlined into dist/assets/*.js, NOT index.html. */
function assertBundleTargetsTestPort(): void {
  let files: string[];
  try {
    files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
  } catch {
    throw new Error(`Built app-tauri assets not found at ${DIST_ASSETS}. Build first.`);
  }
  const baked = files.some((f) => readFileSync(path.join(DIST_ASSETS, f), 'utf8').includes(DAEMON_PORT));
  if (!baked) {
    throw new Error(
      `Built app-tauri bundle does not bake the e2e daemon port ${DAEMON_PORT}. ` +
        `Rebuild: VITE_DAEMON_PORT=${DAEMON_PORT} pnpm --filter @qlan-ro/mainframe-app-tauri build`,
    );
  }
}

function buildAppTauri(): void {
  execFileSync(PNPM, ['--filter', '@qlan-ro/mainframe-app-tauri', 'build'], {
    cwd: APP_TAURI_DIR,
    env: { ...process.env, VITE_DAEMON_PORT: DAEMON_PORT },
    stdio: 'inherit',
  });
}

async function startPreview(): Promise<ChildProcess> {
  const preview = spawn(
    PNPM,
    [
      '--filter',
      '@qlan-ro/mainframe-app-tauri',
      'exec',
      'vite',
      'preview',
      '--strictPort',
      '--host',
      '127.0.0.1',
      '--port',
      String(PREVIEW_PORT),
    ],
    { cwd: APP_TAURI_DIR, env: { ...process.env, VITE_DAEMON_PORT: DAEMON_PORT }, stdio: 'ignore' },
  );
  const deadline = Date.now() + 15_000;
  const ctx = await request.newContext();
  while (Date.now() < deadline) {
    try {
      const res = await ctx.get(PREVIEW_BASE);
      if (res.ok()) {
        await ctx.dispose();
        return preview;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await ctx.dispose();
  preview.kill('SIGKILL');
  throw new Error(`vite preview did not become ready on ${PREVIEW_BASE}`);
}

export async function launchTauriApp(opts?: { recordingKey?: string }): Promise<TauriAppFixture> {
  buildAppTauri();
  assertBundleTargetsTestPort();

  const daemonHandle = await startDaemon({ recordingKey: opts?.recordingKey });
  let preview: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    preview = await startPreview();
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(PREVIEW_BASE, { waitUntil: 'domcontentloaded' });

    // Readiness: the status bar shows "Daemon Connected" once the IPv4 /health poll succeeds.
    await page
      .locator('[data-testid="app-status-bar"]')
      .getByText('Daemon Connected', { exact: true })
      .waitFor({ timeout: 20_000 });

    return { browser, page, preview, daemonHandle };
  } catch (err) {
    await browser?.close().catch(() => {});
    preview?.kill('SIGKILL');
    await stopDaemon(daemonHandle);
    throw err;
  }
}

export async function closeTauriApp(fixture: TauriAppFixture | undefined): Promise<void> {
  if (!fixture) return;
  try {
    await fixture.browser.close();
  } catch (err) {
    console.warn('[e2e-tauri] browser.close failed; continuing teardown:', err);
  }
  fixture.preview.kill();
  await stopDaemon(fixture.daemonHandle);
}
