import { getActiveDaemon } from '@/lib/daemon/active-daemon';

export interface ResolveCwdOptions {
  worktreePath: string | undefined;
  projectPath: string | undefined;
  homedir: string;
}

/**
 * Resolves the working directory for a new terminal session.
 * Priority: active worktree → active project → user home (never "/").
 *
 * When the active daemon is remote, worktree/project paths are server-side
 * paths that do not exist locally (the terminal is always laptop-local).
 * Fall back to the local home directory in that case.
 */
export function resolveCwd({ worktreePath, projectPath, homedir }: ResolveCwdOptions): string {
  if (getActiveDaemon().kind === 'remote') return homedir;
  if (worktreePath?.trim()) return worktreePath.trim();
  if (projectPath?.trim()) return projectPath.trim();
  return homedir;
}
