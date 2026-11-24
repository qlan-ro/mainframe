import { spawn, execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import {
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensurePortFree, recordStarted } from './port-guard.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_DIR = path.resolve(__dirname, '../../..');
const E2E_DIR = path.join(REPO_DIR, 'packages/e2e');
const CORE_RS_DIR = path.join(REPO_DIR, 'packages/core-rs');

// Dedicated e2e port (NOT the dev default 31415) so the harness never collides with — and
// silently runs against — a developer's running Mainframe. The renderer is built to talk to
// this port (VITE_DAEMON_PORT); see `pnpm build:app:tauri` in this package.
export const DAEMON_PORT = process.env['MF_E2E_DAEMON_PORT'] ?? '31416';
export const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

export const E2E_MODE = process.env['E2E_MODE'];
export const RECORDINGS_DIR = path.resolve(__dirname, '../fixtures/recordings');

export function resolveRustDaemon(): string {
  const configured = process.env['MF_E2E_RUST_DAEMON_PATH'];
  if (configured) return path.resolve(configured);

  const release = path.join(CORE_RS_DIR, 'target/release/mainframe-daemon');
  const debug = path.join(CORE_RS_DIR, 'target/debug/mainframe-daemon');
  if (existsSync(release)) return release;
  if (existsSync(debug)) return debug;
  if (process.env['MF_E2E_SKIP_BUILD'] === '1') {
    throw new Error(
      `Rust daemon not found. Build it first: cd ${CORE_RS_DIR} && cargo build --release -p mainframe-daemon`,
    );
  }

  execFileSync('cargo', ['build', '--release', '-p', 'mainframe-daemon'], {
    cwd: CORE_RS_DIR,
    stdio: 'inherit',
  });
  if (!existsSync(release)) throw new Error(`Rust daemon build completed without producing ${release}`);
  return release;
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

async function waitForMockAdapter(maxMs = 10_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${DAEMON_BASE}/api/adapters`);
    if (res.ok) {
      const body = (await res.json()) as { data?: { id?: string; installed?: boolean }[] };
      if (body.data?.some((adapter) => adapter.id === 'mock-cli' && adapter.installed)) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock adapter did not become ready within ${maxMs}ms`);
}

/** What a daemon on a HOME of its own may keep: enough to run programs, never a token or a config path. */
const ISOLATED_ENV = new Set([
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TZ',
  'LANG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'RUST_LOG',
  'RUST_BACKTRACE',
]);

/** This process's environment, or with `home` a minimal one pointed at that HOME alone. */
export function daemonBaseEnv(home?: string): NodeJS.ProcessEnv {
  if (home === undefined) return { ...process.env };
  const kept = Object.entries(process.env).filter(([name]) => ISOLATED_ENV.has(name) || name.startsWith('LC_'));
  return { ...Object.fromEntries(kept), HOME: home, USER: 'you', LOGNAME: 'you' };
}

export interface DaemonHandle {
  daemon: ChildProcess;
  testDataDir: string;
}

export async function startDaemon(opts?: {
  recordingKey?: string;
  recordingsDir?: string;
  dataDir?: string;
  mockMaxDelayMs?: number;
  mockFork?: boolean;
  mockSwitch?: boolean;
  /** The daemon's HOME. The suite keeps the developer's own; a board capture must not read it. */
  home?: string;
}): Promise<DaemonHandle> {
  const daemonPath = resolveRustDaemon();
  // A daemon built elsewhere (MF_E2E_RUST_DAEMON_PATH) is shared, so an orphan of it proves nothing.
  const ownDaemon = daemonPath.startsWith(REPO_DIR + path.sep) ? { command: daemonPath, cwd: E2E_DIR } : undefined;
  await ensurePortFree(
    Number(DAEMON_PORT),
    ownDaemon,
    'Use another: MF_E2E_DAEMON_PORT=<port> (rebuild the UI bundle to match)',
  );
  const testDataDir = opts?.dataDir ?? mkdtempSync(path.join(tmpdir(), 'mf-e2e-data-'));

  const e2eEnv: Record<string, string> = {};
  if (E2E_MODE) {
    e2eEnv['E2E_MODE'] = E2E_MODE;
    e2eEnv['E2E_RECORDINGS_DIR'] = opts?.recordingsDir ?? RECORDINGS_DIR;
    if (opts?.recordingKey) e2eEnv['E2E_RECORDING_KEY'] = opts.recordingKey;
    // Widen the mock replay clamp for specs that must observe a transient state
    // (e.g. the sidebar 'working' dot) whose window the default ~120ms burst collapses.
    if (opts?.mockMaxDelayMs != null) e2eEnv['E2E_MOCK_MAX_DELAY_MS'] = String(opts.mockMaxDelayMs);
    // The mock adapter reports no fork capability unless a fork spec opts in.
    if (opts?.mockFork) e2eEnv['E2E_MOCK_FORK'] = '1';
    // A second mock adapter (`mock-cli-b`) for the provider-switch spec.
    if (opts?.mockSwitch) e2eEnv['E2E_MOCK_SWITCH'] = '1';
  }
  const daemonLogFd = openSync(path.join(testDataDir, 'daemon.log'), 'w');
  const daemon = spawn(daemonPath, [], {
    cwd: E2E_DIR,
    env: { ...daemonBaseEnv(opts?.home), MAINFRAME_DATA_DIR: testDataDir, DAEMON_PORT, ...e2eEnv },
    stdio: ['ignore', daemonLogFd, daemonLogFd],
  });
  recordStarted(daemon.pid);
  closeSync(daemonLogFd); // parent no longer needs the fd; child keeps it open

  // If any post-spawn step throws, kill the daemon before rethrowing so a failed beforeAll never
  // leaks a process holding the port (a worker that dies here leaves it to the run's record, see port-guard.ts).
  try {
    await waitForDaemon();
    if (E2E_MODE === 'mock') await waitForMockAdapter();

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

/**
 * Keep the daemon's logs before its data dir is deleted.
 *
 * The daemon's tracing output goes to `<MAINFRAME_DATA_DIR>/logs/server.<date>.log`
 * (logging.rs; the stdout layer stays quiet, so the spawn's own capture only ever
 * holds a panic). That data dir is the temp dir this file removes at teardown — so
 * on CI the logs of a failing run were destroyed with it, and a Linux-only failure
 * could only be read through the DOM. Both go next to the report, in their own
 * directory rather than inside `playwright-report/`, which the HTML reporter wipes
 * when it writes, and the workflow uploads them.
 */
const DAEMON_LOG_DIR = path.resolve(__dirname, '../daemon-logs');
/** Enough tail to cover a describe; a whole run's logging would dwarf the report. */
const MAX_KEPT_LOG_BYTES = 1_000_000;

function keepTail(source: string, destination: string): void {
  if (!existsSync(source)) return;
  const contents = readFileSync(source);
  if (contents.byteLength === 0) return;
  const kept =
    contents.byteLength > MAX_KEPT_LOG_BYTES ? contents.subarray(contents.byteLength - MAX_KEPT_LOG_BYTES) : contents;
  mkdirSync(DAEMON_LOG_DIR, { recursive: true });
  writeFileSync(destination, kept);
}

async function preserveDaemonLog(handle: DaemonHandle): Promise<void> {
  const name = path.basename(handle.testDataDir);
  const kept: string[] = [];
  try {
    const tracingDir = path.join(handle.testDataDir, 'logs');
    if (existsSync(tracingDir)) {
      for (const file of readdirSync(tracingDir)) {
        const destination = path.join(DAEMON_LOG_DIR, `${name}-${file}`);
        keepTail(path.join(tracingDir, file), destination);
        if (existsSync(destination)) kept.push(destination);
      }
    }
    // Empty unless the daemon panicked — which is exactly when it matters.
    const stdio = path.join(DAEMON_LOG_DIR, `${name}-stdio.log`);
    keepTail(path.join(handle.testDataDir, 'daemon.log'), stdio);
    if (existsSync(stdio)) kept.push(stdio);
  } catch (err) {
    console.warn('[e2e] could not preserve the daemon logs', err);
  }

  // On CI these files are not collected — the workflow uploads only
  // `playwright-report/`, and an attachment made from an `afterAll` hook never
  // reaches it. Read them from the artifact-free path: the local directory below,
  // or add an upload step for `packages/e2e/daemon-logs/` (needs a token with the
  // `workflow` scope).
  if (kept.length > 0) console.log(`[e2e] kept ${kept.length} daemon log(s) for ${name} in daemon-logs/`);
}

export async function stopDaemon(handle: DaemonHandle | undefined, preserveData = false): Promise<void> {
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
  await preserveDaemonLog(handle);
  if (!preserveData) rmSync(handle.testDataDir, { recursive: true, force: true });
}
