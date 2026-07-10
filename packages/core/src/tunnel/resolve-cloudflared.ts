import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export interface ResolveCloudflaredDeps {
  /** PATH string to scan; defaults to `process.env.PATH`. */
  path?: string;
  platform?: NodeJS.Platform;
  isExecutable?: (candidate: string) => Promise<boolean>;
}

async function defaultIsExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    /* not executable or missing — not a match */
    return false;
  }
}

/**
 * Resolve `cloudflared` to an absolute path by scanning PATH, so spawned tunnels
 * can be recorded and later reaped by exact binary path (never a bare name — a
 * bare match could kill an unrelated user process after PID reuse). Returns null
 * when cloudflared is not on PATH.
 */
export async function resolveCloudflaredPath(deps: ResolveCloudflaredDeps = {}): Promise<string | null> {
  const pathVar = deps.path ?? process.env['PATH'] ?? '';
  const platform = deps.platform ?? process.platform;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const binary = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}
