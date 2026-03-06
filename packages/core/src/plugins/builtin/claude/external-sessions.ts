import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createChildLogger } from '../../../logger.js';
import type { ExternalSession } from '@mainframe/types';

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

export async function listExternalSessions(
  projectPath: string,
  excludeSessionIds: string[],
): Promise<ExternalSession[]> {
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const indexPath = path.join(homedir(), '.claude', 'projects', encodedPath, 'sessions-index.json');

  let raw: string;
  try {
    raw = await readFile(indexPath, 'utf-8');
  } catch {
    // No index file — return empty (no fallback to JSONL scan by design)
    return [];
  }

  let index: SessionIndex;
  try {
    index = JSON.parse(raw) as SessionIndex;
  } catch {
    logger.warn({ indexPath }, 'Malformed sessions-index.json');
    return [];
  }

  if (!index.entries || !Array.isArray(index.entries)) {
    logger.warn({ indexPath }, 'sessions-index.json has no entries array');
    return [];
  }

  const excludeSet = new Set(excludeSessionIds);

  return index.entries
    .filter((entry) => {
      if (!entry.sessionId) return false;
      if (excludeSet.has(entry.sessionId)) return false;
      if (entry.isSidechain) return false;
      return true;
    })
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
