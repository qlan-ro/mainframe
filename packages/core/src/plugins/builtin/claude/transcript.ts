import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path for a session. */
export function getSessionJsonlPath(sessionId: string, projectPath: string): { jsonlPath: string; projectDir: string } {
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(homedir(), '.claude', 'projects', encodedPath);
  return { jsonlPath: path.join(projectDir, sessionId + '.jsonl'), projectDir };
}

/**
 * Whether the CLI transcript for `sessionId` still exists on disk. Checks the
 * stored `session_file_path` first (authoritative — survives worktree moves),
 * then the path derived from the project path.
 */
export async function isClaudeTranscriptPresent(
  sessionId: string,
  projectPath: string,
  sessionFilePath?: string | null,
): Promise<boolean> {
  const candidates = [sessionFilePath, getSessionJsonlPath(sessionId, projectPath).jsonlPath].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return true;
    } catch {
      /* expected: candidate missing, try the next one */
    }
  }
  return false;
}
