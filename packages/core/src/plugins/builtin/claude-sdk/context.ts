import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ContextFile } from '@qlan-ro/mainframe-types';

const CONTEXT_FILES = ['CLAUDE.md', 'AGENTS.md'];

export function getContextFilesForProject(projectPath: string): {
  global: ContextFile[];
  project: ContextFile[];
} {
  const globalFiles: ContextFile[] = [];
  const projectFiles: ContextFile[] = [];

  const globalDir = join(homedir(), '.claude');
  for (const name of CONTEXT_FILES) {
    const filePath = join(globalDir, name);
    if (existsSync(filePath)) {
      try {
        globalFiles.push({
          path: filePath,
          content: readFileSync(filePath, 'utf-8'),
          source: 'global',
        });
      } catch {
        /* expected — file may be unreadable */
      }
    }
  }

  for (const name of CONTEXT_FILES) {
    const filePath = join(projectPath, name);
    if (existsSync(filePath)) {
      try {
        projectFiles.push({
          path: filePath,
          content: readFileSync(filePath, 'utf-8'),
          source: 'project',
        });
      } catch {
        /* expected — file may be unreadable */
      }
    }
  }

  return { global: globalFiles, project: projectFiles };
}
