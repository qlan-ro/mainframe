import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExternalSession, ExternalSessionPage } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../../logger.js';
import { canonicalizeProjectPath, discoverProjectDirs, isUuidJsonl } from './external-session-paths.js';
import { enrichSession, type Candidate } from './external-session-enrich.js';
import { getCached, setCached } from './external-session-cache.js';

const logger = createChildLogger('claude:external-sessions');

const DEFAULT_LIMIT = 50;
const ENRICH_CONCURRENCY = 8;
const TITLE_GEN_PREFIX = 'Generate a short title (2-5 words) for a coding chat that';

/** Stat-only candidate pass: UUID-named jsonl across all matching dirs, deduped + sorted mtime desc. */
export async function scanLiteCandidates(projectPath: string, excludeSet: Set<string>): Promise<Candidate[]> {
  const canonical = await canonicalizeProjectPath(projectPath);
  const dirs = await discoverProjectDirs(canonical);
  const bySession = new Map<string, Candidate>();

  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      /* expected: dir vanished between discovery and read */
      continue;
    }
    for (const name of names) {
      if (!isUuidJsonl(name)) continue;
      const sessionId = name.slice(0, -'.jsonl'.length);
      if (excludeSet.has(sessionId)) continue;
      const filePath = path.join(dir, name);
      let st: { mtimeMs: number; size: number };
      try {
        const s = await stat(filePath);
        st = { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        /* expected: file deleted mid-scan */
        continue;
      }
      const prev = bySession.get(sessionId);
      if (!prev || st.mtimeMs > prev.mtimeMs) {
        bySession.set(sessionId, { sessionId, filePath, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  }

  return [...bySession.values()].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.sessionId < b.sessionId ? 1 : -1));
}

/** Enrich a window with bounded concurrency, using the cache for unchanged files. */
async function enrichWindow(window: Candidate[], projectPath: string): Promise<ExternalSession[]> {
  const out: (ExternalSession | null)[] = new Array(window.length).fill(null);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= window.length) return;
      const c = window[i]!;
      const cached = getCached(c.sessionId, c.mtimeMs, c.size);
      if (cached) {
        out[i] = cached;
        continue;
      }
      const meta = await enrichSession(c, projectPath);
      if (meta) {
        setCached(c.sessionId, c.mtimeMs, c.size, meta);
        out[i] = meta;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, window.length) }, worker));
  return out.filter((s): s is ExternalSession => s !== null && !isTitleGenGhost(s));
}

/** Belt-and-suspenders for pre-existing title-gen ghost files (new ones are prevented upstream). */
function isTitleGenGhost(s: ExternalSession): boolean {
  return !!s.firstPrompt && s.firstPrompt.startsWith(TITLE_GEN_PREFIX);
}

export async function listExternalSessions(
  projectPath: string,
  excludeSessionIds: string[],
  opts?: { offset?: number; limit?: number },
): Promise<ExternalSessionPage> {
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  let candidates: Candidate[];
  try {
    candidates = await scanLiteCandidates(projectPath, new Set(excludeSessionIds));
  } catch (err) {
    logger.warn({ err: String(err), projectPath }, 'external-session lite scan failed');
    return { sessions: [], total: 0, nextOffset: null };
  }

  const total = candidates.length;
  if (limit <= 0) return { sessions: [], total, nextOffset: offset };

  const window = candidates.slice(offset, offset + limit);
  const sessions = await enrichWindow(window, projectPath);
  const nextOffset = offset + limit < total ? offset + limit : null;
  return { sessions, total, nextOffset };
}
