/**
 * resolveWorktree — shared helper that finds a WorktreeEntry by dir name or branch.
 *
 * Matching strategy (in priority order):
 *  1. Anchored basename: `entry.path.split('/').pop() === dirName`
 *     A bare dirname like "feat-login" matches "/projects/wt/feat-login" but NOT
 *     a mere suffix like "oologin".  Branches containing "/" (e.g. "feat/login")
 *     are NOT valid basenames and will never match here.
 *  2. branchName fallback: `entry.branch === branchName`
 *     Used when the dirname is unavailable or unresolvable.
 */
import type { WorktreeEntry } from '@/lib/api/git';

export interface ResolveWorktreeQuery {
  dirName?: string;
  branchName?: string;
}

export function resolveWorktree(
  worktrees: WorktreeEntry[],
  { dirName, branchName }: ResolveWorktreeQuery,
): WorktreeEntry | undefined {
  if (dirName !== undefined) {
    const byDir = worktrees.find((w) => w.path.split('/').pop() === dirName);
    if (byDir) return byDir;
  }
  if (branchName !== undefined) {
    return worktrees.find((w) => w.branch === branchName);
  }
  return undefined;
}
