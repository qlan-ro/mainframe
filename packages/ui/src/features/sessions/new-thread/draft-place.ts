/** Where a draft would run, as far as its captures and annotations care. */
import { useProjectsStore } from '@/store/projects';
import type { DraftCfg } from '../runtime/draft-config';

export type DraftPlace = Pick<DraftCfg, 'projectId' | 'worktreePath' | 'pendingWorktree'>;

/** A branch checked out in place, a temporary session and a worktree's new name leave the files where they are. */
export function samePlace(a: DraftPlace, b: DraftPlace): boolean {
  return (
    a.projectId === b.projectId &&
    (a.worktreePath ?? null) === (b.worktreePath ?? null) &&
    (a.pendingWorktree == null) === (b.pendingWorktree == null)
  );
}

export function placeName(setup: DraftCfg): string | undefined {
  if (setup.worktreePath) return setup.branchName ?? setup.worktreePath.split(/[\\/]/).pop();
  return useProjectsStore.getState().projects.find(({ id }) => id === setup.projectId)?.name;
}
