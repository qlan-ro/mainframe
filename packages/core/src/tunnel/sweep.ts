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
}

export interface SweepResult {
  total: number;
  reaped: number;
  skipped: number;
}

/**
 * Confirm a live process really is the cloudflared child we spawned before
 * killing it. We require the command to reference the exact absolute binary
 * recorded at spawn: a bare name (or a different cloudflared binary that reused
 * the pid) must NOT match, or the sweep could kill an unrelated user process.
 */
export function processMatchesBinary(command: string, binPath: string): boolean {
  if (!isAbsolute(binPath)) return false;
  return command.includes(binPath);
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
 */
export async function sweepStrayTunnels(
  registry: TunnelRegistryPort,
  deps: SweepDeps = defaultSweepDeps,
): Promise<SweepResult> {
  const entries = await registry.list();
  let reaped = 0;

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
