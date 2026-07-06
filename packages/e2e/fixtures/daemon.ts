import { spawn, execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, openSync, closeSync, mkdirSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROD_DAEMON_PORT = '31415';
export { PROD_DAEMON_PORT };

// Core daemon entry — run with plain Node.js to avoid native module ABI mismatch
// (better-sqlite3 is compiled for system Node.js, not Electron's bundled runtime).
export const DAEMON_ENTRY = path.resolve(__dirname, '../../../packages/core/dist/index.js');

// Dedicated e2e port (NOT the dev default 31415) so the harness never collides with — and
// silently runs against — a developer's running Mainframe. The renderer is built to talk to
// this port (VITE_DAEMON_HTTP_PORT/WS_PORT); see `pnpm build:app` in this package.
export const DAEMON_PORT = process.env['MF_E2E_DAEMON_PORT'] ?? '31416';
export const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

export const E2E_MODE = process.env['E2E_MODE'];
export const RECORDINGS_DIR = path.resolve(__dirname, '../fixtures/recordings');
export const MOCK_PLUGIN_DIR = path.resolve(__dirname, '../plugins/mock-cli');
export const ESBUILD_BIN = path.resolve(__dirname, '../../../node_modules/.bin/esbuild');

export function buildMockPlugin(): void {
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

async function isDaemonReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_BASE}/api/projects`, { signal: AbortSignal.timeout(1_000) });
    return res.ok;
  } catch {
    return false; /* connection refused / timeout = port is free, which is what we want */
  }
}

/**
 * Best-effort reap of a stale e2e daemon left squatting on our port by a prior Playwright run
 * that timed out mid-describe (a timed-out worker is discarded without running `afterAll`, so
 * `stopDaemon` — and the SIGTERM it sends — never fires; see batch4-fixes-report.md). Left
 * unreaped, the zombie holds `DAEMON_PORT` for the rest of the process, and every later
 * describe's `assertPortFree()` fails instantly, cascading through the whole remaining run.
 *
 * Deliberately conservative: only ever kills a process whose full command line is unmistakably
 * OUR daemon entrypoint (`node .../core/dist/index.js`). Anything else on the port — a
 * developer's real Mainframe instance, an unrelated process — is left alone and still fails loud
 * via the `assertPortFree` error below. Returns true if it killed something worth re-checking for.
 */
function reapStaleE2eDaemon(): boolean {
  let pids: string[];
  try {
    pids = execFileSync('lsof', ['-ti', `tcp:${DAEMON_PORT}`], { encoding: 'utf8' })
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
  } catch {
    return false; // lsof found nothing bound to the port (or isn't on PATH) — nothing to reap
  }

  let killedAny = false;
  for (const pid of pids) {
    let cmdline: string;
    try {
      cmdline = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim();
    } catch {
      continue; // process exited between lsof and ps — nothing left to kill
    }
    if (!cmdline.includes('node') || !cmdline.includes(path.join('core', 'dist', 'index.js'))) {
      continue; // not our daemon entrypoint — never kill an unrecognized process
    }
    try {
      process.kill(Number(pid), 'SIGKILL');
      killedAny = true;
    } catch {
      // already exited — fine, that's the outcome we wanted anyway
    }
  }
  return killedAny;
}

/**
 * Fail fast if something is already answering on our port. Without this, a foreign daemon
 * (e.g. a dev Mainframe) would absorb the bind and the suite would run against — and pollute —
 * real data. See git history: this exact footgun registered junk projects in a real instance.
 *
 * Before failing, make one attempt to reap a stale *e2e* daemon (see `reapStaleE2eDaemon`) —
 * this is the common case when a previous run timed out mid-test. A daemon left by a clean
 * developer session, or anything not matching our entrypoint, is never touched and still throws.
 */
export async function assertPortFree(): Promise<void> {
  let reachable = await isDaemonReachable();
  if (reachable && reapStaleE2eDaemon()) {
    // Give the OS a moment to release the socket after SIGKILL, then re-check once.
    await new Promise((r) => setTimeout(r, 500));
    reachable = await isDaemonReachable();
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

export async function waitForDaemon(maxMs = 30_000): Promise<void> {
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

export interface DaemonHandle {
  daemon: ChildProcess;
  testDataDir: string;
}

export async function startDaemon(opts?: { recordingKey?: string }): Promise<DaemonHandle> {
  await assertPortFree();
  const testDataDir = mkdtempSync(path.join(tmpdir(), 'mf-e2e-data-'));

  // E2E record/replay wiring. In mock mode, build + copy the external plugin into the isolated
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
  // Redirect daemon output to a file — keeps test output readable.
  // Inspect testDataDir/daemon.log if a test fails and you need daemon logs.
  const daemonLogFd = openSync(path.join(testDataDir, 'daemon.log'), 'w');
  const daemon = spawn('node', [DAEMON_ENTRY], {
    // The daemon reads DAEMON_PORT (see core/src/config.ts), NOT PORT.
    env: { ...process.env, MAINFRAME_DATA_DIR: testDataDir, DAEMON_PORT, ...e2eEnv },
    stdio: ['ignore', daemonLogFd, daemonLogFd],
  });
  closeSync(daemonLogFd); // parent no longer needs the fd; child keeps it open

  // If any post-spawn step throws, kill the daemon before rethrowing so a failed beforeAll never
  // leaks a process holding the port (which would cascade-fail every later spec via assertPortFree).
  try {
    await waitForDaemon();

    // Set Haiku as the default model — tests run fast and cheap.
    // Tests that exercise model-switching override this per-chat via chat.updateConfig.
    await fetch(`${DAEMON_BASE}/api/settings/providers/claude`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'claude-haiku-4-5-20251001' }),
    });
    return { daemon, testDataDir };
  } catch (err) {
    daemon.kill('SIGKILL');
    throw err;
  }
}

export async function stopDaemon(handle: DaemonHandle | undefined): Promise<void> {
  if (!handle) return;
  await new Promise<void>((resolve) => {
    if (handle.daemon.exitCode !== null) return resolve();
    handle.daemon.on('exit', () => resolve());
    handle.daemon.kill();
    // Safety timeout — don't block forever if SIGTERM is ignored
    setTimeout(() => {
      handle.daemon.kill('SIGKILL');
      resolve();
    }, 3_000);
  });
  rmSync(handle.testDataDir, { recursive: true, force: true });
}
