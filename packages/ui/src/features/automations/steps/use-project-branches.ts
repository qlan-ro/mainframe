/**
 * useProjectBranches — local branches for a project, feeding the Agent
 * step's worktree base-branch `BranchSelect` (todo #234 bullet 4). The step
 * itself carries no project picker — it inherits the automation's own
 * resolved `activeProjectId` (see `AgentConfig.tsx`), so this hook just
 * needs that id, not a chat/session context.
 *
 * `getGitBranches`'s `port` param is vestigial (`lib/api/http.ts`'s
 * `apiBase` ignores it — the active daemon target resolves on its own);
 * passing a placeholder avoids this feature needing `useDaemonPort()`/a
 * `DaemonPortProvider`, matching its existing daemon-target-agnostic
 * convention (`data/http-gateway.ts`, `lib/api/automations.ts`).
 */
import { useEffect, useState } from 'react';
import { getGitBranches } from '@/lib/api/git';

export interface ProjectBranches {
  branches: string[];
  currentBranch: string;
}

const EMPTY: ProjectBranches = { branches: [], currentBranch: '' };
const IGNORED_PORT = 0;

export function useProjectBranches(projectId: string | null): ProjectBranches {
  const [result, setResult] = useState<ProjectBranches>(EMPTY);

  useEffect(() => {
    if (!projectId) {
      setResult(EMPTY);
      return;
    }
    let cancelled = false;
    getGitBranches(IGNORED_PORT, projectId)
      .then((res) => {
        if (cancelled) return;
        setResult({ branches: res.local.map((b) => b.name), currentBranch: res.current });
      })
      .catch(() => {
        if (!cancelled) setResult(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return result;
}
