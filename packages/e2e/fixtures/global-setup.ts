import { request } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DAEMON_PORT } from './daemon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The vite app is `packages/ui` (`@qlan-ro/mainframe-ui`). `packages/app-tauri` is the Rust/Tauri
// shell (no vite build script) — it depends on packages/ui's build output, it isn't the app itself.
const UI_DIR = path.resolve(__dirname, '../../../packages/ui');
const DIST_ASSETS = path.join(UI_DIR, 'dist', 'assets');
const PNPM = 'pnpm';

export const PREVIEW_PORT = Number(process.env['MF_E2E_PREVIEW_PORT'] ?? 4317);
export const PREVIEW_BASE = `http://127.0.0.1:${PREVIEW_PORT}`;

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

async function startPreview(): Promise<ChildProcess> {
  const preview = spawn(
    PNPM,
    [
      '--filter',
      '@qlan-ro/mainframe-ui',
      'exec',
      'vite',
      'preview',
      '--strictPort',
      '--host',
      '127.0.0.1',
      '--port',
      String(PREVIEW_PORT),
    ],
    { cwd: UI_DIR, env: { ...process.env, VITE_DAEMON_PORT: DAEMON_PORT }, stdio: 'ignore' },
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isPreviewServing()) return preview;
    await new Promise((r) => setTimeout(r, 200));
  }
  preview.kill('SIGKILL');
  throw new Error(`vite preview did not become ready on ${PREVIEW_BASE}`);
}

/**
 * `vite preview` is a stateless static file server for the built packages/ui bundle. It used to be
 * respawned in every describe's beforeAll (via launchTauriApp) and killed in afterAll — the same
 * static server, torn up and down 100+ times a run. Start it once here and share it across every
 * spec and describe; per-describe isolation comes from a fresh BrowserContext + a fresh daemon, not
 * a fresh file server. Returns a teardown that kills the preview when the whole run ends.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  buildUi();
  assertBundleTargetsTestPort();

  // A preview left alive by a prior invocation (e.g. the per-file sweep reuses the port across
  // back-to-back runs) is adopted as-is rather than fought over --strictPort. We didn't spawn it,
  // so we don't kill it.
  if (await isPreviewServing()) return async () => {};

  const preview = await startPreview();
  return async () => {
    preview.kill('SIGKILL');
  };
}
