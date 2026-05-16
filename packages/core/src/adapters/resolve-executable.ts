import { execFile } from 'node:child_process';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('resolve-executable');

export const BARE_NAMES: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

export interface RunResult {
  ok: boolean;
  stdout: string;
}
export interface ResolverDeps {
  settings: { get(c: string, k: string): string | null; set(c: string, k: string, v: string): void };
  run: (cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>;
  platform?: NodeJS.Platform;
}
export interface ResolvedExecutable {
  path: string;
  source: 'config' | 'detected' | 'fallback';
  valid: boolean;
  version?: string;
}

export function defaultRun(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts?.timeoutMs ?? 5000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: typeof stdout === 'string' ? stdout : '' });
    });
  });
}

function parseVersion(stdout: string): string | undefined {
  const m = stdout.match(/(\d+\.\d+\.\d+)/);
  return m?.[1];
}

async function validate(path: string, run: ResolverDeps['run']): Promise<{ valid: boolean; version?: string }> {
  const r = await run(path, ['--version'], { timeoutMs: 5000 });
  if (!r.ok) return { valid: false };
  const version = parseVersion(r.stdout);
  return version ? { valid: true, version } : { valid: true };
}

export async function resolveAdapterExecutable(adapterId: string, deps: ResolverDeps): Promise<ResolvedExecutable> {
  const bare = BARE_NAMES[adapterId] ?? adapterId;
  const configured = deps.settings.get('provider', `${adapterId}.executablePath`);
  if (configured) {
    const v = await validate(configured, deps.run);
    return { path: configured, source: 'config', ...v };
  }
  const platform = deps.platform ?? process.platform;
  const finder = platform === 'win32' ? 'where' : 'which';
  const found = await deps.run(finder, [bare], { timeoutMs: 5000 });
  if (found.ok) {
    const abs = found.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (abs) {
      const v = await validate(abs, deps.run);
      return { path: abs, source: 'detected', ...v };
    }
  }
  return { path: bare, source: 'fallback', valid: false };
}

export async function backfillAdapterExecutables(adapterIds: string[], deps: ResolverDeps): Promise<void> {
  for (const id of adapterIds) {
    try {
      if (deps.settings.get('provider', `${id}.executablePath`)) continue;
      const r = await resolveAdapterExecutable(id, deps);
      if (r.source === 'detected') {
        deps.settings.set('provider', `${id}.executablePath`, r.path);
        log.info({ adapterId: id, path: r.path }, 'backfilled adapter executable path');
      }
    } catch (err) {
      log.warn({ err, adapterId: id }, 'executable backfill failed for adapter');
    }
  }
}
