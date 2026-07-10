import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { createChildLogger } from '../logger.js';
import type { ChildRegistryPort, ManagedChildEntry } from './child-registry.js';

const log = createChildLogger('child-sweep');

const PS_TIMEOUT_MS = 5_000;

export interface SweepDeps {
  /** Full command line of a running pid, or null when the pid is not alive. */
  processCommand: (pid: number) => Promise<string | null>;
  /** Working directory of a running pid, or null when unknown (needed for launch identity). */
  processCwd: (pid: number) => Promise<string | null>;
  /**
   * Deliver `signal` to `pid` (or its process group when `group` is true).
   * Returns true when the target was signalled or is already gone; false when
   * the kill failed for any other reason (e.g. EPERM on an orphan owned by
   * another user), which tells the sweep to keep the record.
   */
  kill: (pid: number, signal: NodeJS.Signals, group: boolean) => boolean;
  /** Platform whose process-inspection tooling the sweep needs; win32 has no `ps`. */
  platform?: NodeJS.Platform;
}

export interface SweepResult {
  total: number;
  reaped: number;
  skipped: number;
}

/**
 * Confirm a live process really is the tunnel child we spawned before killing
 * it. We require argv[0] to be the exact absolute binary recorded at spawn: a
 * bare name, a sibling binary sharing the path as a prefix (cloudflared-updater),
 * or the path appearing only as an argument (a log file) must NOT match, or the
 * sweep could kill an unrelated user process.
 */
export function processMatchesBinary(command: string, binPath: string): boolean {
  if (!isAbsolute(binPath)) return false;
  return command === binPath || command.startsWith(`${binPath} `);
}

/**
 * Confirm a live process really is the launch child we spawned. Launch children
 * run arbitrary user commands, so — unlike tunnels — we cannot rely on a known
 * binary. We require the FULL recorded argv to match the live command line
 * exactly (a fragment must not match, so a superset like `pnpm run dev --host`
 * is rejected) AND the recorded cwd to match the live cwd. Either mismatch means
 * the pid was reused by another process (or the same command in another
 * project), so the group must not be killed.
 */
export function processMatchesLaunch(command: string | null, cwd: string | null, entry: ManagedChildEntry): boolean {
  if (command == null) return false;
  const recorded = entry.args.length > 0 ? `${entry.command} ${entry.args.join(' ')}` : entry.command;
  if (command !== recorded) return false;
  // cwd is a hard guard: an unreadable (null) or differing cwd rejects the match.
  if (entry.cwd != null && cwd !== entry.cwd) return false;
  return true;
}

function matchesEntry(entry: ManagedChildEntry, command: string | null, cwd: string | null): boolean {
  if (command == null) return false;
  if (entry.group) return processMatchesLaunch(command, cwd, entry);
  return processMatchesBinary(command, entry.command);
}

export function defaultProcessCommand(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'command='], { timeout: PS_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const line = (typeof stdout === 'string' ? stdout : '').trim();
      resolve(line || null);
    });
  });
}

/**
 * Read a pid's working directory. macOS and Linux both expose it via `lsof`
 * (`-d cwd`, field `n`), which avoids the platform split between `/proc` and BSD.
 * Returns null on any failure — the sweep treats an unknown cwd as a mismatch.
 */
export function defaultProcessCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], { timeout: PS_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const line = (typeof stdout === 'string' ? stdout : '').split('\n').find((l) => l.startsWith('n'));
      resolve(line ? line.slice(1).trim() || null : null);
    });
  });
}

export function defaultKill(pid: number, signal: NodeJS.Signals, group: boolean): boolean {
  const target = group ? -pid : pid;
  try {
    process.kill(target, signal);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      log.debug({ pid, signal, group }, 'sweep kill: process already gone');
      return true;
    }
    log.warn({ pid, signal, group, err }, 'sweep kill failed');
    return false;
  }
}

export const defaultSweepDeps: SweepDeps = {
  processCommand: defaultProcessCommand,
  processCwd: defaultProcessCwd,
  kill: defaultKill,
};

/**
 * Reap tunnel and launch children orphaned by a previous daemon run. Reads the
 * pidfile registry and, for each recorded pid still alive whose identity still
 * matches what we recorded (guarding against PID reuse), kills it — the pid for
 * tunnels, the whole process GROUP for detached launch trees so wrapper
 * grandchildren (pnpm → vite → esbuild) die with it. Every record it handles is
 * pruned: a reaped orphan, a dead pid, or a pid reused by another process.
 *
 * A record is kept only when the orphan is still alive but the kill failed (e.g.
 * EPERM on a root-owned orphan): dropping it would discard the sole record of a
 * live orphan, so we leave it for a future run or manual cleanup instead.
 *
 * On win32 there is no `ps`/`lsof` to inspect a pid, so we cannot verify identity
 * before killing. Rather than blindly kill (PID reuse) or clear the registry
 * (discarding the only record of the orphans), we skip and leave it intact.
 */
export async function sweepStrayChildren(
  registry: ChildRegistryPort,
  deps: SweepDeps = defaultSweepDeps,
): Promise<SweepResult> {
  const entries = await registry.list();
  let reaped = 0;

  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') {
    if (entries.length > 0) {
      log.warn(
        { total: entries.length },
        'startup child sweep unsupported on win32; leaving registry intact so orphaned pids are not lost',
      );
    }
    return { total: entries.length, reaped: 0, skipped: entries.length };
  }

  for (const entry of entries) {
    const command = await deps.processCommand(entry.pid);
    const cwd = command != null && entry.group ? await deps.processCwd(entry.pid) : null;
    if (!matchesEntry(entry, command, cwd)) {
      log.debug(
        { pid: entry.pid, kind: entry.kind, label: entry.label, alive: command != null },
        'pruning child registry entry (process gone or not ours)',
      );
      await registry.remove(entry.pid);
      continue;
    }

    log.warn(
      { pid: entry.pid, kind: entry.kind, label: entry.label, group: entry.group },
      'reaping stray child orphaned by a previous daemon run',
    );
    let killed = false;
    try {
      killed = deps.kill(entry.pid, 'SIGTERM', entry.group);
    } catch (err) {
      log.warn({ err, pid: entry.pid }, 'sweep kill threw');
    }
    if (killed) {
      reaped += 1;
      await registry.remove(entry.pid);
    } else {
      log.warn(
        { pid: entry.pid, kind: entry.kind, label: entry.label },
        'kept child registry entry: kill failed, orphan may still be alive',
      );
    }
  }

  return { total: entries.length, reaped, skipped: entries.length - reaped };
}
