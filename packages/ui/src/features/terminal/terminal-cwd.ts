export interface ResolveCwdOptions {
  worktreePath: string | undefined;
  projectPath: string | undefined;
  homedir: string;
}

/**
 * Resolves the working directory for a new terminal session.
 * Priority: active worktree → active project → user home (never "/").
 */
export function resolveCwd({ worktreePath, projectPath, homedir }: ResolveCwdOptions): string {
  if (worktreePath?.trim()) return worktreePath.trim();
  if (projectPath?.trim()) return projectPath.trim();
  return homedir;
}
