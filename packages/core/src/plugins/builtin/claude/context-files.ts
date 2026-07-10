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
    const content = readIfPresent(path.join(globalDir, name));
    if (content !== null) {
      // Display the real global location so it can't be mistaken for a
      // same-named project file (#222).
      global.push({ path: `~/.claude/${name}`, content, source: 'global' });
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
