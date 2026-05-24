import { access, constants, readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { homedir } from 'node:os';
import { createChildLogger } from '../../../logger.js';
import type { ExternalSession } from '@qlan-ro/mainframe-types';

const logger = createChildLogger('claude:external-sessions');

interface SessionIndexEntry {
  sessionId: string;
  fullPath?: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

interface SessionIndex {
  version: number;
  entries: SessionIndexEntry[];
}

function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9-]/g, '-');
}

function projectsRoot(): string {
  return path.join(homedir(), '.claude', 'projects');
}

/** Belongs to this project if cwd equals the root or is nested under it. */
function cwdBelongsToProject(cwd: string | undefined, projectPath: string): boolean {
  if (!cwd) return false;
  if (cwd === projectPath) return true;
  return cwd.startsWith(projectPath + path.sep);
}

/** Discover every encoded dir under ~/.claude/projects whose prefix matches the project. */
async function discoverProjectDirs(projectPath: string): Promise<string[]> {
  const root = projectsRoot();
  const encodedPrefix = encodePath(projectPath);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name === encodedPrefix || name.startsWith(encodedPrefix + '-'))
    .map((name) => path.join(root, name));
}

/** Scan all matching dirs for the project; verify each session by cwd. */
export async function listExternalSessions(
  projectPath: string,
  excludeSessionIds: string[],
): Promise<ExternalSession[]> {
  const excludeSet = new Set(excludeSessionIds);
  const candidateDirs = await discoverProjectDirs(projectPath);
  const aggregated: ExternalSession[] = [];

  for (const dir of candidateDirs) {
    const fromIndex = await listFromIndex(dir, projectPath, excludeSet);
    const sessions = fromIndex ?? (await listFromJsonl(dir, projectPath, excludeSet));
    aggregated.push(...sessions);
  }

  const seen = new Set<string>();
  const deduped: ExternalSession[] = [];
  for (const session of aggregated) {
    if (seen.has(session.sessionId)) continue;
    if (!cwdBelongsToProject(session.cwd, projectPath)) continue;
    seen.add(session.sessionId);
    deduped.push(session);
  }

  return deduped.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

async function listFromIndex(
  projectDir: string,
  projectPath: string,
  excludeSet: Set<string>,
): Promise<ExternalSession[] | null> {
  const indexPath = path.join(projectDir, 'sessions-index.json');

  let raw: string;
  try {
    raw = await readFile(indexPath, 'utf-8');
  } catch {
    return null;
  }

  let index: SessionIndex;
  try {
    index = JSON.parse(raw) as SessionIndex;
  } catch {
    logger.warn({ indexPath }, 'Malformed sessions-index.json');
    return null;
  }

  if (!index.entries || !Array.isArray(index.entries)) {
    logger.warn({ indexPath }, 'sessions-index.json has no entries array');
    return null;
  }

  if (index.entries.length === 0) return null;

  const candidates = index.entries.filter(
    (e) => e.sessionId && !excludeSet.has(e.sessionId) && !e.isSidechain && e.firstPrompt,
  );

  const verified: ExternalSession[] = [];
  for (const entry of candidates) {
    const jsonlPath = entry.fullPath ?? path.join(projectDir, entry.sessionId + '.jsonl');
    let fileMtimeIso: string | undefined;
    try {
      const s = await stat(jsonlPath);
      fileMtimeIso = s.mtime.toISOString();
    } catch {
      try {
        await access(jsonlPath, constants.R_OK);
      } catch {
        continue; // JSONL deleted — skip ghost entry
      }
    }

    const indexMtimeIso = typeof entry.fileMtime === 'number' ? new Date(entry.fileMtime).toISOString() : undefined;

    const createdAt = entry.created ?? entry.modified ?? indexMtimeIso ?? fileMtimeIso;
    const modifiedAt = entry.modified ?? indexMtimeIso ?? fileMtimeIso ?? entry.created;
    if (!createdAt || !modifiedAt) {
      // Without any real timestamp, omit the session rather than fake "now".
      logger.warn({ sessionId: entry.sessionId }, 'no timestamp available for session, skipping');
      continue;
    }

    verified.push({
      sessionId: entry.sessionId,
      adapterId: 'claude',
      projectPath,
      cwd: entry.projectPath,
      firstPrompt: entry.firstPrompt,
      summary: entry.summary,
      messageCount: entry.messageCount,
      createdAt,
      modifiedAt,
      gitBranch: entry.gitBranch || undefined,
    });
  }

  return verified.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

async function listFromJsonl(
  projectDir: string,
  projectPath: string,
  excludeSet: Set<string>,
): Promise<ExternalSession[]> {
  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch {
    return [];
  }

  const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl'));
  const sessions: ExternalSession[] = [];

  for (const file of jsonlFiles) {
    const sessionId = file.replace('.jsonl', '');
    if (excludeSet.has(sessionId)) continue;

    const filePath = path.join(projectDir, file);
    try {
      const session = await extractSessionMeta(filePath, sessionId, projectPath);
      if (session) sessions.push(session);
    } catch (err) {
      logger.warn({ err: String(err), filePath }, 'failed to read external session file');
    }
  }

  return sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

async function extractSessionMeta(
  filePath: string,
  sessionId: string,
  projectPath: string,
): Promise<ExternalSession | null> {
  const fileStat = await stat(filePath);
  const modifiedAt = fileStat.mtime.toISOString();

  const stream = createReadStream(filePath);
  let firstPrompt: string | undefined;
  let createdAt: string | undefined;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let isSidechain = false;
  let linesRead = 0;

  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      linesRead++;
      if (linesRead > 50) break;

      try {
        const entry = JSON.parse(line);

        if (entry.isSidechain) {
          isSidechain = true;
          break;
        }

        if (!createdAt && entry.timestamp) createdAt = entry.timestamp;
        if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch;
        if (!cwd && entry.cwd) cwd = entry.cwd;

        if (!firstPrompt && entry.type === 'user' && entry.message?.content) {
          if (entry.sessionId && entry.sessionId !== sessionId) continue;
          const content = entry.message.content;
          const raw = extractRawText(content, 2000);
          const cleaned = raw ? stripCommandBoilerplate(raw) : undefined;
          if (cleaned) firstPrompt = cleaned.slice(0, 500);
        }

        if (firstPrompt && createdAt && gitBranch && cwd) break;
      } catch {
        // Skip malformed lines
      }
    }
  } finally {
    stream.destroy();
  }

  if (isSidechain) return null;
  if (!firstPrompt) return null;

  return {
    sessionId,
    adapterId: 'claude',
    projectPath,
    cwd,
    firstPrompt,
    createdAt: createdAt ?? modifiedAt,
    modifiedAt,
    gitBranch: gitBranch || undefined,
  };
}

function extractRawText(content: unknown, limit = 200): string | undefined {
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && block.text) return (block.text as string).slice(0, limit);
    }
    return undefined;
  }
  if (typeof content === 'string') return content.slice(0, limit);
  return undefined;
}

function stripCommandBoilerplate(text: string): string {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
