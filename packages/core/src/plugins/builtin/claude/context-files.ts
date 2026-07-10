import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ContextFile } from '@qlan-ro/mainframe-types';

const CONTEXT_FILE_NAMES = ['CLAUDE.md', 'AGENTS.md'] as const;

/**
 * Collect the Claude context files that apply to a session: the user-global
 * ones under ~/.claude plus the project-scoped ones (repo root and .claude/).
 * `homeDir` is injectable so the global path is testable without reading the
 * real home directory.
 */
export function collectClaudeContextFiles(
  projectPath: string,
  homeDir: string = homedir(),
): { global: ContextFile[]; project: ContextFile[] } {
  const global: ContextFile[] = [];
  const globalDir = path.join(homeDir, '.claude');
  for (const name of CONTEXT_FILE_NAMES) {
    const abs = path.join(globalDir, name);
    const content = readIfPresent(abs);
    if (content !== null) {
      // Absolute path (not a `~`-prefixed string): the daemon's GET /files route
      // whitelists absolute paths under ~/.claude, and it distinguishes a global
      // CLAUDE.md from a same-named project one — the UI never expands `~` (#222).
      global.push({ path: abs, content, source: 'global' });
    }
  }

  const project: ContextFile[] = [];
  for (const name of CONTEXT_FILE_NAMES) {
    for (const dir of [projectPath, path.join(projectPath, '.claude')]) {
      const abs = path.join(dir, name);
      const content = readIfPresent(abs);
      if (content !== null) {
        project.push({ path: path.relative(projectPath, abs), content, source: 'project' });
      }
    }
  }

  return { global, project };
}

function readIfPresent(abs: string): string | null {
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, 'utf-8');
  } catch {
    /* expected: unreadable file (perms/race) — skip it */
    return null;
  }
}
