import { open, stat } from 'node:fs/promises';
import type { ExternalSession } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../../logger.js';
import { cwdBelongsToProject } from './external-session-paths.js';

const logger = createChildLogger('claude:external-session-enrich');

export const SYNTHETIC_TITLE = '(session)';
const READ_BYTES = 64 * 1024;

export interface Candidate {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
  size: number;
}

/** Read up to `bytes` from the start and end of the file (deduped if the file is small). */
async function readHeadTail(filePath: string): Promise<{ head: string; tail: string }> {
  const { size } = await stat(filePath);
  const handle = await open(filePath, 'r');
  try {
    const headLen = Math.min(READ_BYTES, size);
    const headBuf = Buffer.alloc(headLen);
    await handle.read(headBuf, 0, headLen, 0);
    const head = headBuf.toString('utf-8');

    if (size <= READ_BYTES) return { head, tail: head };

    const tailLen = Math.min(READ_BYTES, size);
    const tailBuf = Buffer.alloc(tailLen);
    await handle.read(tailBuf, 0, tailLen, size - tailLen);
    return { head, tail: tailBuf.toString('utf-8') };
  } finally {
    await handle.close();
  }
}

function parseLines(chunk: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of chunk.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      /* expected: truncated/partial line at a 64KB boundary */
    }
  }
  return out;
}

function rawText(content: unknown, limit = 2000): string | undefined {
  if (Array.isArray(content)) {
    for (const block of content) {
      const b = block as { type?: string; text?: string };
      if (b?.type === 'text' && b.text) return b.text.slice(0, limit);
    }
    return undefined;
  }
  if (typeof content === 'string') return content.slice(0, limit);
  return undefined;
}

function cleanPrompt(text: string): string {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickString(entries: Record<string, unknown>[], key: string): string | undefined {
  for (const e of entries) {
    const v = e[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Read the file's head/tail, apply hide rules, and project to an ExternalSession (or null to drop). */
export async function enrichSession(candidate: Candidate, projectPath: string): Promise<ExternalSession | null> {
  let head: string;
  let tail: string;
  try {
    ({ head, tail } = await readHeadTail(candidate.filePath));
  } catch (err) {
    logger.warn({ err: String(err), filePath: candidate.filePath }, 'failed to read external session file');
    return null;
  }

  // Robust to truncated giant first lines: substring-scan the raw head for the hide flags.
  if (/"isSidechain"\s*:\s*true/.test(head) || /"teamName"\s*:/.test(head)) return null;

  const headEntries = parseLines(head);
  const tailEntries = parseLines(tail);
  const all = [...headEntries, ...tailEntries];

  const cwd = pickString(all, 'cwd');
  if (!cwdBelongsToProject(cwd, projectPath)) return null;

  const gitBranch = pickString(all, 'gitBranch');
  const createdAt = pickString(all, 'timestamp');

  const firstUser = headEntries.find(
    (e) => e.type === 'user' && (e as { message?: { content?: unknown } }).message?.content !== undefined,
  );
  const firstPromptRaw = firstUser
    ? rawText((firstUser as { message: { content: unknown } }).message.content)
    : undefined;
  const firstPrompt = firstPromptRaw ? cleanPrompt(firstPromptRaw).slice(0, 500) : undefined;

  // Title precedence: customTitle > aiTitle > summary > firstPrompt > synthetic.
  const title =
    pickString(all, 'customTitle') ??
    pickString(all, 'aiTitle') ??
    pickString(all, 'summary') ??
    firstPrompt ??
    SYNTHETIC_TITLE;

  let modifiedAt: string;
  try {
    modifiedAt = (await stat(candidate.filePath)).mtime.toISOString();
  } catch {
    modifiedAt = new Date(candidate.mtimeMs).toISOString();
  }

  return {
    sessionId: candidate.sessionId,
    adapterId: 'claude',
    projectPath,
    cwd,
    firstPrompt,
    title,
    createdAt: createdAt ?? modifiedAt,
    modifiedAt,
    gitBranch: gitBranch || undefined,
  };
}
