/** Where a new session will run, read off its draft config (K7). */
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

export type DraftEnvironment =
  | { kind: 'local' }
  | { kind: 'temporary' }
  | { kind: 'new-worktree'; base: string; branchName: string }
  | { kind: 'worktree'; branch: string; path: string };

export function draftEnvironment(draft: DraftCfg): DraftEnvironment {
  if (draft.pendingWorktree) {
    return {
      kind: 'new-worktree',
      base: draft.pendingWorktree.baseBranch,
      branchName: draft.pendingWorktree.branchName,
    };
  }
  if (draft.worktreePath) {
    return { kind: 'worktree', branch: draft.branchName ?? 'detached', path: draft.worktreePath };
  }
  return draft.temporary ? { kind: 'temporary' } : { kind: 'local' };
}

/** The draft fields that say where a session runs: worktree and temporary exclude each other. */
export function environmentPatch(next: DraftEnvironment): Partial<DraftCfg> {
  const none = { worktreePath: undefined, branchName: undefined, pendingWorktree: undefined, temporary: false };
  switch (next.kind) {
    case 'local':
      return none;
    case 'temporary':
      return { ...none, temporary: true };
    case 'new-worktree':
      return { ...none, pendingWorktree: { baseBranch: next.base, branchName: next.branchName } };
    case 'worktree':
      return { ...none, worktreePath: next.path, branchName: next.branch };
  }
}

/** A branch name to start a new worktree with; the user can type another. */
export function suggestBranchName(taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const name = `session-${n}`;
    if (!taken.includes(name)) return name;
  }
}
