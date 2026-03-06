import { readFile, readdir, stat } from 'node:fs/promises';
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

function getProjectDir(projectPath: string): string {
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(homedir(), '.claude', 'projects', encodedPath);
}

/** Try sessions-index.json first; fall back to JSONL scan. */
export async function listExternalSessions(
  projectPath: string,
  excludeSessionIds: string[],
): Promise<ExternalSession[]> {
  const projectDir = getProjectDir(projectPath);
  const excludeSet = new Set(excludeSessionIds);

  const fromIndex = await listFromIndex(projectDir, projectPath, excludeSet);
  if (fromIndex !== null) return fromIndex;

  return listFromJsonl(projectDir, projectPath, excludeSet);
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
    return null; // No index — use fallback
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

  return index.entries
    .filter((e) => e.sessionId && !excludeSet.has(e.sessionId) && !e.isSidechain)
    .map(
      (entry): ExternalSession => ({
        sessionId: entry.sessionId,
        adapterId: 'claude',
        projectPath,
        firstPrompt: entry.firstPrompt,
        summary: entry.summary,
        messageCount: entry.messageCount,
        createdAt: entry.created ?? new Date().toISOString(),
        modifiedAt: entry.modified ?? entry.created ?? new Date().toISOString(),
        gitBranch: entry.gitBranch || undefined,
      }),
    )
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

/** Scan *.jsonl files, reading the first user message from each for metadata. */
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
    } catch {
      // Skip unreadable files
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

  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let firstPrompt: string | undefined;
  let createdAt: string | undefined;
  let gitBranch: string | undefined;
  let isSidechain = false;
  let linesRead = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    linesRead++;
    if (linesRead > 30) break; // Only scan first 30 lines for metadata

    try {
      const entry = JSON.parse(line);

      if (entry.isSidechain) {
        isSidechain = true;
        break;
      }

      if (!createdAt && entry.timestamp) createdAt = entry.timestamp;
      if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch;

      if (!firstPrompt && entry.type === 'user' && entry.message?.content) {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && block.text) {
              firstPrompt = block.text.slice(0, 200);
              break;
            }
          }
        } else if (typeof content === 'string') {
          firstPrompt = content.slice(0, 200);
        }
      }

      if (firstPrompt && createdAt && gitBranch) break; // Got everything we need
    } catch {
      // Skip malformed lines
    }
  }

  rl.close();

  if (isSidechain) return null;

  return {
    sessionId,
    adapterId: 'claude',
    projectPath,
    firstPrompt,
    createdAt: createdAt ?? modifiedAt,
    modifiedAt,
    gitBranch: gitBranch || undefined,
  };
}
