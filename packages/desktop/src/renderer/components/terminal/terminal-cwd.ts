export interface ResolveCwdOptions {
  worktreePath: string | undefined;
  projectPath: string | undefined;
  homedir: string;
}

/**
 * Resolves the working directory for a new terminal session.
 *
 * Priority:
 *  1. Active chat's worktreePath (if non-empty)
 *  2. Active project's path (if non-empty)
 *  3. User home directory — NEVER falls back to "/"
 */
export function resolveCwd({ worktreePath, projectPath, homedir }: ResolveCwdOptions): string {
  if (worktreePath?.trim()) return worktreePath.trim();
  if (projectPath?.trim()) return projectPath.trim();
  return homedir;
}
