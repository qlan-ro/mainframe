import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { createChildLogger } from '../logger.js';
import type { TunnelRegistryPort } from './tunnel-registry.js';

const log = createChildLogger('tunnel-sweep');

const PS_TIMEOUT_MS = 5_000;

export interface SweepDeps {
  /** Full command line of a running pid, or null when the pid is not alive. */
  processCommand: (pid: number) => Promise<string | null>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  /** Platform whose process-inspection tooling the sweep needs; win32 has no `ps`. */
  platform?: NodeJS.Platform;
}

export interface SweepResult {
  total: number;
  reaped: number;
  skipped: number;
}

/**
 * Confirm a live process really is the cloudflared child we spawned before
 * killing it. We require argv[0] to be the exact absolute binary recorded at
 * spawn: a bare name, a sibling binary sharing the path as a prefix
 * (cloudflared-updater), or the path appearing only as an argument (a log file)
 * must NOT match, or the sweep could kill an unrelated user process.
 */
export function processMatchesBinary(command: string, binPath: string): boolean {
  if (!isAbsolute(binPath)) return false;
  return command === binPath || command.startsWith(`${binPath} `);
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

export function defaultKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      log.debug({ pid, signal }, 'sweep kill: process already gone');
    } else {
      log.warn({ pid, signal, err }, 'sweep kill failed');
    }
  }
}

export const defaultSweepDeps: SweepDeps = {
  processCommand: defaultProcessCommand,
  kill: defaultKill,
};

/**
 * Reap cloudflared children orphaned by a previous daemon run. Reads the pidfile
 * registry, kills each recorded pid that is still alive AND still running the
 * exact binary we recorded (guarding against PID reuse), then clears the
 * registry so this run starts from a clean slate.
 *
 * On win32 there is no `ps` to inspect a pid's command line, so we cannot verify
 * identity before killing. Rather than blindly kill (PID reuse) or clear the
 * registry (silently discarding the only record of the orphans), we skip the
 * sweep and leave the registry intact for a future run or manual cleanup.
 */
export async function sweepStrayTunnels(
  registry: TunnelRegistryPort,
  deps: SweepDeps = defaultSweepDeps,
): Promise<SweepResult> {
  const entries = await registry.list();
  let reaped = 0;

  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') {
    if (entries.length > 0) {
      log.warn(
        { total: entries.length },
        'startup tunnel sweep unsupported on win32; leaving registry intact so orphaned cloudflared pids are not lost',
      );
    }
    return { total: entries.length, reaped: 0, skipped: entries.length };
  }

  for (const entry of entries) {
    const command = await deps.processCommand(entry.pid);
    if (command && processMatchesBinary(command, entry.binPath)) {
      log.warn(
        { pid: entry.pid, label: entry.label, binPath: entry.binPath },
        'reaping stray cloudflared tunnel orphaned by a previous daemon run',
      );
      try {
        deps.kill(entry.pid, 'SIGTERM');
      } catch (err) {
        log.warn({ err, pid: entry.pid }, 'sweep kill threw');
      }
      reaped += 1;
    } else {
      log.debug(
        { pid: entry.pid, label: entry.label, alive: command != null },
        'skipping tunnel registry entry (process gone or not our cloudflared)',
      );
    }
  }

  await registry.clear();
  return { total: entries.length, reaped, skipped: entries.length - reaped };
}
