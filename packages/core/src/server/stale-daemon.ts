/**
 * Pre-listen stale-daemon takeover.
 *
 * An app update can leave the previous install's daemon orphaned (ppid 1) and
 * still owning the port: the new daemon then dies on EADDRINUSE while the UI
 * happily talks to the old, contract-skewed process. Before binding, probe the
 * port's occupant via GET /health and — only when it is a Mainframe daemon of a
 * DIFFERENT version — terminate it and take the port over.
 *
 * A same-version occupant is left alone: the port bind is the daemon's
 * single-instance guard (see index.ts), and same version means no contract skew.
 * A non-Mainframe occupant is never touched.
 */
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createChildLogger } from '../logger.js';
import { DAEMON_VERSION } from '../version.js';

const log = createChildLogger('stale-daemon');
const execFileAsync = promisify(execFile);

const HEALTH_TIMEOUT_MS = 2_000;
const KILL_POLL_INTERVAL_MS = 200;
const SIGKILL_EXTRA_TIMEOUT_MS = 2_000;

export type StaleDaemonOutcome = 'port-free' | 'replaced' | 'same-version' | 'foreign';

export interface ReplaceStaleDaemonOptions {
  ownVersion?: string;
  /** How long to wait for the occupant to die after SIGTERM before SIGKILL. */
  killSignalTimeoutMs?: number;
}

type Probe = { kind: 'mainframe'; version: string; pid: number | null } | { kind: 'port-free' } | { kind: 'foreign' };

async function probeHealth(port: number): Promise<Probe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'foreign' };
    const body = (await res.json()) as { status?: unknown; version?: unknown; pid?: unknown };
    if (body?.status !== 'ok' || typeof body.version !== 'string') return { kind: 'foreign' };
    return { kind: 'mainframe', version: body.version, pid: typeof body.pid === 'number' ? body.pid : null };
  } catch (err) {
    // Nothing accepting connections → the port is free. Anything else that is
    // listening but not speaking our health protocol (timeout, hangup, bad
    // JSON) is a foreign process we must not touch.
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    if (code === 'ECONNREFUSED') return { kind: 'port-free' };
    return { kind: 'foreign' };
  }
}

/** Resolve the listener's pid via lsof — fallback for old daemons whose /health predates the pid field. */
async function lsofListenerPid(port: number): Promise<number | null> {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    const pid = Number.parseInt(stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

/** True when nothing holds the port (a bind attempt succeeds). */
async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await delay(KILL_POLL_INTERVAL_MS);
  }
  return portIsFree(port);
}

/**
 * Probe the port and, when a different-version Mainframe daemon owns it, kill
 * it (SIGTERM, then SIGKILL) and wait for the port to free up.
 *
 * @throws when a stale daemon was identified but could not be terminated —
 *   binding would fail anyway, so the caller should treat this as fatal.
 */
export async function replaceStaleDaemon(
  port: number,
  opts: ReplaceStaleDaemonOptions = {},
): Promise<StaleDaemonOutcome> {
  const ownVersion = opts.ownVersion ?? DAEMON_VERSION;
  const killTimeout = opts.killSignalTimeoutMs ?? 5_000;

  const probe = await probeHealth(port);
  if (probe.kind === 'port-free') return 'port-free';
  if (probe.kind === 'foreign') {
    log.warn({ port }, 'port is occupied by a non-Mainframe process — leaving it alone');
    return 'foreign';
  }
  if (probe.version === ownVersion) {
    log.warn({ port, version: probe.version }, 'a same-version daemon already owns the port (duplicate launch)');
    return 'same-version';
  }

  const pid = probe.pid ?? (await lsofListenerPid(port));
  if (pid == null || pid <= 1 || pid === process.pid) {
    log.error({ port, version: probe.version }, 'stale daemon detected but its pid could not be resolved');
    return 'foreign';
  }

  log.warn({ port, pid, staleVersion: probe.version, ownVersion }, 'terminating stale daemon from a previous install');
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* expected — the process may have exited between probe and kill */
  }
  if (await waitForPortFree(port, killTimeout)) return 'replaced';

  log.warn({ port, pid }, 'stale daemon ignored SIGTERM — escalating to SIGKILL');
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* expected — may have just exited */
  }
  if (await waitForPortFree(port, SIGKILL_EXTRA_TIMEOUT_MS)) return 'replaced';

  throw new Error(`stale daemon (pid ${pid}) still holds port ${port} after SIGKILL`);
}
