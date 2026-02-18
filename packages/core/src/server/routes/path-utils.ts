import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function resolveAndValidatePath(basePath: string, requestedPath: string): string | null {
  try {
    const realBase = realpathSync(basePath);
    const fullPath = realpathSync(path.resolve(basePath, requestedPath));
    return fullPath.startsWith(realBase) ? fullPath : null;
  } catch {
    return null;
  }
}

/**
 * Allow reading files under ~/.claude/ (plans, skills, etc.)
 * when the path resolves outside the project directory.
 */
export function resolveClaudeConfigPath(basePath: string, requestedPath: string): string | null {
  try {
    const claudeDir = realpathSync(path.join(homedir(), '.claude'));
    const fullPath = realpathSync(path.resolve(basePath, requestedPath));
    return fullPath.startsWith(claudeDir + path.sep) ? fullPath : null;
  } catch {
    return null;
  }
}
