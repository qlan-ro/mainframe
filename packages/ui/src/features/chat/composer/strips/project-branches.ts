/**
 * The branch each project's checkout is on, shared by the branch picker above
 * a new session's composer and the empty state's "Local checkout on …" (K7,
 * K11), so a checkout from one shows in the other.
 */
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { getGitBranch } from '@/lib/api/git';

interface ProjectBranchesState {
  /** null: not a repository, detached, or the read failed. */
  byProject: Readonly<Record<string, string | null>>;
}

export const useProjectBranches = create<ProjectBranchesState>(() => ({ byProject: {} }));

/** The newest read of a project; an older answer is dropped. */
const newest = new Map<string, object>();

export function setProjectBranch(projectId: string, branch: string | null): void {
  newest.delete(projectId);
  useProjectBranches.setState((s) => ({ byProject: { ...s.byProject, [projectId]: branch } }));
}

async function read(port: number, projectId: string): Promise<void> {
  const token = {};
  newest.set(projectId, token);
  const branch = await getGitBranch(port, projectId).then(
    (result) => result.branch ?? null,
    (error: unknown) => {
      console.warn('[project-branches] branch read failed', { error });
      return null;
    },
  );
  if (newest.get(projectId) === token) setProjectBranch(projectId, branch);
}

/** `branch` is undefined until it is known. */
export function useProjectBranch(
  port: number,
  projectId: string | null,
): { branch?: string | null; reload: () => void } {
  const branch = useProjectBranches((s) => (projectId == null ? undefined : s.byProject[projectId]));
  const reload = useCallback(() => {
    if (projectId != null) void read(port, projectId);
  }, [port, projectId]);
  useEffect(reload, [reload]);
  return { branch, reload };
}
