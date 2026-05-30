import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * True when `realTarget` is `realBase` itself or lies strictly beneath it.
 * The `+ path.sep` guard is security-critical: a bare `startsWith(realBase)`
 * would admit a sibling like `/proj-evil` for base `/proj`.
 */
export function isWithinBase(realBase: string, realTarget: string): boolean {
  return realTarget === realBase || realTarget.startsWith(realBase + path.sep);
}

export function resolveAndValidatePath(basePath: string, requestedPath: string): string | null {
  try {
    const realBase = realpathSync(basePath);
    const fullPath = realpathSync(path.resolve(basePath, requestedPath));
    return isWithinBase(realBase, fullPath) ? fullPath : null;
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
    return isWithinBase(claudeDir, fullPath) ? fullPath : null;
  } catch {
    return null;
  }
}
