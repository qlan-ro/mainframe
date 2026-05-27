import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createChildLogger } from '../logger.js';

type WarnFn = { warn: (...args: unknown[]) => void };
let _log: WarnFn = createChildLogger('background-tasks:lsof') as unknown as WarnFn;

type ExecFn = (cmd: string, args: string[], opts: object) => Promise<{ stdout: string; stderr: string }>;
let _exec: ExecFn = promisify(execFile) as unknown as ExecFn;
let warnedMissing = false;

/** Test-only seam (also resets the ENOENT warn-once latch). */
export function __setExecForTests(fn: ExecFn): void {
  _exec = fn;
  warnedMissing = false;
}

/** Test-only seam — swap the logger so warn calls are observable. */
export function __setLoggerForTests(logger: WarnFn): void {
  _log = logger;
  warnedMissing = false;
}

const TIMEOUT_MS = 2000;

async function runLsof(path: string): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await _exec('lsof', ['-F', 'pan', '--', path], {
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
    });
    return { ok: true, stdout };
  } catch (err) {
    type LsofExecError = Omit<NodeJS.ErrnoException, 'code'> & {
      code?: number | string;
      signal?: string;
      stdout?: string;
    };
    const e = err as LsofExecError;
    // lsof returns 1 when there are no matches — that's a clean "empty", not a failure.
    if (e.code === 1) return { ok: true, stdout: e.stdout ?? '' };
    if (e.code === 'ENOENT') {
      // Liveness ticks fire once per task per minute. Warn once per process to keep logs sane.
      if (!warnedMissing) {
        _log.warn('lsof binary not found; background-task OS fallbacks disabled');
        warnedMissing = true;
      }
      return { ok: false, error: 'lsof not installed' };
    }
    if (e.signal) return { ok: false, error: `lsof killed by signal ${e.signal}` };
    return { ok: false, error: `lsof exited code=${e.code}` };
  }
}

function parsePids(stdout: string, accept: (mode: string) => boolean): number[] {
  const pids: number[] = [];
  let pendingPid: number | null = null;
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const tag = line[0]!;
    const rest = line.slice(1);
    if (tag === 'p') {
      const n = Number(rest);
      pendingPid = Number.isInteger(n) && n > 0 ? n : null;
    } else if (tag === 'a' && pendingPid !== null) {
      if (accept(rest)) pids.push(pendingPid);
      pendingPid = null;
    }
  }
  return pids;
}

export async function lsofWritersDetailed(
  path: string,
): Promise<{ ok: true; pids: number[] } | { ok: false; error: string }> {
  const r = await runLsof(path);
  if (!r.ok) return r;
  return { ok: true, pids: parsePids(r.stdout, (m) => m === 'w' || m === 'u') };
}

export async function lsofWriters(path: string): Promise<number[]> {
  const r = await lsofWritersDetailed(path);
  return r.ok ? r.pids : [];
}

export async function lsofAny(path: string): Promise<number[]> {
  const r = await runLsof(path);
  if (!r.ok) return [];
  return parsePids(r.stdout, () => true);
}
