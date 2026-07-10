// Discover importable Codex sessions by scanning the rollout JSONL files Codex
// writes to ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl.
// We scan the files directly (not Codex's state DB) so sessions started outside
// Mainframe are found too — the same reason the Claude scanner reads *.jsonl
// rather than trusting an index. A session belongs to a project when the `cwd`
// recorded in its session_meta is the project root or nested under it.

import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type { ExternalSession, ExternalSessionPage } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../../logger.js';
import { extractMeta, firstUserPrompt, parseLines, type RolloutMeta } from './external-session-parse.js';

const logger = createChildLogger('codex:external-sessions');

const DEFAULT_LIMIT = 50;
const SCAN_CONCURRENCY = 8;
// Small read covers the session_meta line (cwd + git branch) for filtering and
// counting every candidate. Larger read reaches the first real user prompt,
// which sits past Codex's bundled preamble (~70KB in); only the enriched page
// window pays this cost.
const META_BYTES = 32 * 1024;
const PROMPT_BYTES = 192 * 1024;
const WALK_MAX_DEPTH = 4; // sessions/YYYY/MM/DD/rollout-*.jsonl
const SYNTHETIC_TITLE = '(session)';

const ROLLOUT_RE = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export interface CodexScanDeps {
  /** Sessions root the rollouts live under — injectable for tests. */
  sessionsRoot?: string;
}

interface Candidate {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
  size: number;
}

type MatchedSession = RolloutMeta & { candidate: Candidate };

const metaCache = new Map<string, { mtimeMs: number; size: number; meta: RolloutMeta }>();
const promptCache = new Map<string, { mtimeMs: number; size: number; firstPrompt?: string }>();

export function clearCodexExternalSessionCache(): void {
  metaCache.clear();
  promptCache.clear();
}

export function codexSessionsRoot(): string {
  return join(homedir(), '.codex', 'sessions');
}

/** Belongs to this project if cwd equals the root or is nested under it. */
function cwdBelongsToProject(cwd: string | undefined, projectPath: string): boolean {
  if (!cwd) return false;
  if (cwd === projectPath) return true;
  return cwd.startsWith(projectPath + sep);
}

async function walkRollouts(dir: string, depth: number, out: Candidate[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    /* expected: date dir vanished or root absent */
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < WALK_MAX_DEPTH) await walkRollouts(full, depth + 1, out);
      continue;
    }
    const match = ROLLOUT_RE.exec(entry.name);
    if (!match) continue;
    try {
      const st = await stat(full);
      out.push({ sessionId: match[1]!, filePath: full, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      /* expected: file deleted mid-scan */
    }
  }
}

async function readHead(filePath: string, bytes: number): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    await handle.read(buf, 0, len, 0);
    return buf.toString('utf-8');
  } finally {
    await handle.close();
  }
}

async function loadMeta(candidate: Candidate): Promise<RolloutMeta | null> {
  const cached = metaCache.get(candidate.sessionId);
  if (cached && cached.mtimeMs === candidate.mtimeMs && cached.size === candidate.size) return cached.meta;

  let head: string;
  try {
    head = await readHead(candidate.filePath, META_BYTES);
  } catch (err) {
    logger.warn({ err: String(err), filePath: candidate.filePath }, 'failed to read rollout head');
    return null;
  }
  const meta = extractMeta(parseLines(head), head);
  metaCache.set(candidate.sessionId, { mtimeMs: candidate.mtimeMs, size: candidate.size, meta });
  return meta;
}

async function loadFirstPrompt(candidate: Candidate): Promise<string | undefined> {
  const cached = promptCache.get(candidate.sessionId);
  if (cached && cached.mtimeMs === candidate.mtimeMs && cached.size === candidate.size) return cached.firstPrompt;

  let firstPrompt: string | undefined;
  try {
    firstPrompt = firstUserPrompt(parseLines(await readHead(candidate.filePath, PROMPT_BYTES)));
  } catch (err) {
    logger.warn({ err: String(err), filePath: candidate.filePath }, 'failed to read rollout prompt');
  }
  promptCache.set(candidate.sessionId, { mtimeMs: candidate.mtimeMs, size: candidate.size, firstPrompt });
  return firstPrompt;
}

/** Map over items with bounded concurrency, preserving order. */
async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, items.length) }, worker));
  return out;
}

async function collectCandidates(root: string, excludeSet: Set<string>): Promise<Candidate[]> {
  const collected: Candidate[] = [];
  await walkRollouts(root, 0, collected);

  const bySession = new Map<string, Candidate>();
  for (const c of collected) {
    if (excludeSet.has(c.sessionId)) continue;
    const prev = bySession.get(c.sessionId);
    if (!prev || c.mtimeMs > prev.mtimeMs) bySession.set(c.sessionId, c);
  }
  return [...bySession.values()].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.sessionId < b.sessionId ? 1 : -1));
}

function toExternalSession(m: MatchedSession, firstPrompt: string | undefined, projectPath: string): ExternalSession {
  const modifiedAt = new Date(m.candidate.mtimeMs).toISOString();
  return {
    sessionId: m.candidate.sessionId,
    adapterId: 'codex',
    projectPath,
    cwd: m.cwd,
    firstPrompt,
    title: firstPrompt ?? SYNTHETIC_TITLE,
    createdAt: m.createdAt ?? modifiedAt,
    modifiedAt,
    gitBranch: m.gitBranch,
  };
}

export async function listExternalSessions(
  projectPath: string,
  excludeSessionIds: string[],
  opts?: { offset?: number; limit?: number },
  deps?: CodexScanDeps,
): Promise<ExternalSessionPage> {
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const root = deps?.sessionsRoot ?? codexSessionsRoot();

  let candidates: Candidate[];
  try {
    candidates = await collectCandidates(root, new Set(excludeSessionIds));
  } catch (err) {
    logger.warn({ err: String(err), projectPath }, 'codex external-session scan failed');
    return { sessions: [], total: 0, nextOffset: null };
  }

  const metas = await pooled(candidates, loadMeta);
  const matched: MatchedSession[] = candidates
    .map((candidate, i) => ({ candidate, meta: metas[i] }))
    .filter(
      (x): x is { candidate: Candidate; meta: RolloutMeta } => !!x.meta && cwdBelongsToProject(x.meta.cwd, projectPath),
    )
    .map((x) => ({ ...x.meta, candidate: x.candidate }));

  const total = matched.length;
  if (limit <= 0) return { sessions: [], total, nextOffset: null };

  const window = matched.slice(offset, offset + limit);
  const prompts = await pooled(window, (m) => loadFirstPrompt(m.candidate));
  const sessions = window.map((m, i) => toExternalSession(m, prompts[i], projectPath));
  const nextOffset = offset + limit < total ? offset + limit : null;
  return { sessions, total, nextOffset };
}
