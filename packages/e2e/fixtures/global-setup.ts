import { request } from '@playwright/test';
import { spawn, execFileSync } from 'child_process';
import { createRequire } from 'module';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DAEMON_PORT, ensureDaemonPortFree } from './daemon.ts';
import { beginRun, ensurePortFree, harnessPort, isServing, recordStarted } from './port-guard.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The vite app is `packages/ui` (`@qlan-ro/mainframe-ui`). `packages/app-tauri` is the Rust/Tauri
// shell (no vite build script) — it depends on packages/ui's build output, it isn't the app itself.
const UI_DIR = path.resolve(__dirname, '../../../packages/ui');
const DIST_ASSETS = path.join(UI_DIR, 'dist', 'assets');
const PNPM = 'pnpm';

export const PREVIEW_PORT = harnessPort('MF_E2E_PREVIEW_PORT', '4317');
if (String(PREVIEW_PORT) === DAEMON_PORT) throw new Error('The preview and the daemon need a port each.');
export const PREVIEW_BASE = `http://127.0.0.1:${PREVIEW_PORT}`;

/**
 * Refuse to run without an explicit adapter mode.
 *
 * This suite is built for `E2E_MODE=mock`: it is what wires E2E_RECORDINGS_DIR +
 * E2E_RECORDING_KEY into the daemon and registers the `mock-cli` adapter that
 * `createTauriChat` defaults to. Without it every `launchTauriApp({ recordingKey })` is
 * silently inert and chats spawn the DEVELOPER'S REAL `claude` CLI — so
 * recording-dependent specs fail for reasons that look exactly like product
 * regressions (a context meter reading 0, a skills list showing the developer's own
 * ~/.claude skills), and the run bills real API calls. CI has always set the variable;
 * a bare `pnpm test:e2e` did not, which cost a 40-minute run and a day spent chasing
 * three families of phantom regressions. The scripts now set it — this is the backstop
 * for a direct `playwright test`.
 */
function assertAdapterModeChosen(): void {
  if (process.env['E2E_MODE'] && process.env['MF_E2E_ALLOW_REAL_ADAPTER'] === '1') {
    throw new Error('Choose either E2E_MODE or MF_E2E_ALLOW_REAL_ADAPTER, not both');
  }
  if (process.env['E2E_MODE']) return;
  if (process.env['MF_E2E_ALLOW_REAL_ADAPTER'] === '1') return;
  throw new Error(
    'E2E_MODE is unset, so this run would drive the REAL `claude` CLI and every recording ' +
      'would be inert.\n' +
      '  Normal run:        pnpm test:e2e            (sets E2E_MODE=mock for you)\n' +
      '  Direct invocation: E2E_MODE=mock pnpm --filter @qlan-ro/mainframe-e2e exec playwright test\n' +
      '  Live-adapter checks: MF_E2E_ALLOW_REAL_ADAPTER=1 (bills real API calls)',
  );
}

/**
 * Skip via `MF_E2E_SKIP_BUILD=1` when running against an already-built, already-verified bundle.
 * Safe to skip because assertBundleTargetsTestPort() still runs unconditionally right after and
 * fails fast if dist/ is missing or was built for a different port.
 */
function buildUi(): void {
  if (process.env['MF_E2E_SKIP_BUILD'] === '1') return;
  execFileSync(PNPM, ['--filter', '@qlan-ro/mainframe-ui', 'build'], {
    cwd: UI_DIR,
    env: { ...process.env, VITE_DAEMON_PORT: DAEMON_PORT },
    stdio: 'inherit',
  });
}

/** Fail fast if the built JS bundle doesn't bake the e2e daemon port.
 *  VITE_DAEMON_PORT is inlined into dist/assets/*.js, NOT index.html. */
function assertBundleTargetsTestPort(): void {
  let files: string[];
  try {
    files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
  } catch {
    throw new Error(`Built @qlan-ro/mainframe-ui assets not found at ${DIST_ASSETS}. Build first.`);
  }
  const baked = files.some((f) => readFileSync(path.join(DIST_ASSETS, f), 'utf8').includes(DAEMON_PORT));
  if (!baked) {
    throw new Error(
      `Built @qlan-ro/mainframe-ui bundle does not bake the e2e daemon port ${DAEMON_PORT}. ` +
        `Rebuild: VITE_DAEMON_PORT=${DAEMON_PORT} pnpm --filter @qlan-ro/mainframe-ui build`,
    );
  }
}

async function isPreviewServing(): Promise<boolean> {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(PREVIEW_BASE, { timeout: 1_000 });
    return res.ok();
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

const REMEDY = 'Use another: MF_E2E_PREVIEW_PORT=<port>';

// Vite itself, not through pnpm: killing a pnpm wrapper leaves the server it started behind.
function previewCommand(): string[] {
  const vite = createRequire(path.join(UI_DIR, 'package.json')).resolve('vite/package.json');
  const bin = path.join(path.dirname(vite), 'bin/vite.js');
  return [process.execPath, bin, 'preview', '--strictPort', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT)];
}

async function ensurePreviewPortFree(): Promise<void> {
  await ensurePortFree(PREVIEW_PORT, { command: previewCommand().join(' '), cwd: UI_DIR }, REMEDY);
}

async function startPreview(): Promise<void> {
  await ensurePreviewPortFree();
  const [node, ...args] = previewCommand();
  const preview = spawn(node!, args, {
    cwd: UI_DIR,
    env: { ...process.env, VITE_DAEMON_PORT: DAEMON_PORT },
    stdio: 'ignore',
  });
  recordStarted(preview, PREVIEW_PORT);
  const deadline = Date.now() + 15_000;
  try {
    while (Date.now() < deadline) {
      if (isServing(preview, PREVIEW_PORT, REMEDY) && (await isPreviewServing())) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`vite preview did not become ready on ${PREVIEW_BASE}`);
  } catch (err) {
    preview.kill('SIGKILL');
    throw err;
  }
}

/**
 * `vite preview` is a stateless static file server for the built packages/ui bundle. It used to be
 * respawned in every describe's beforeAll (via launchTauriApp) and killed in afterAll — the same
 * static server, torn up and down 100+ times a run. Start it once here and share it across every
 * spec and describe; per-describe isolation comes from a fresh BrowserContext + a fresh daemon, not
 * a fresh file server. Returns a teardown that kills whatever the run started and is still alive.
 *
 * Each invocation serves the bundle IT just verified: a survivor from a crashed run of this worktree is
 * killed rather than adopted. Any other process on the port makes the run refuse to start (port-guard.ts),
 * so concurrent invocations need ports of their own: `MF_E2E_PREVIEW_PORT`, `MF_E2E_DAEMON_PORT`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  assertAdapterModeChosen();
  const endRun = beginRun();
  try {
    // Before the build: a run that is refused must not replace the bundle another run serves.
    await ensurePreviewPortFree();
    await ensureDaemonPortFree();
    buildUi();
    assertBundleTargetsTestPort();
    await startPreview();
  } catch (err) {
    endRun();
    throw err;
  }
  return async () => endRun();
}
