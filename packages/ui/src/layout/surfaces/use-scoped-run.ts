/**
 * The workspace's panes as the ACTIVE session sees them. Workspace tabs are
 * global and scope-stamped, so a tab opened under another project or worktree
 * must not leak in here. The title bar's tabs and the panel's bodies both read
 * this, which is what keeps them showing the same set.
 */
import { useMemo } from 'react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { activeLaunchScope } from '@/lib/launch-scope';
import { useLayoutStore } from '@/store/layout';
import { filterRunByScope } from '@/store/run-scope-filter';
import type { RunState } from '@/store/run-pane';

export function useScopedRun(): { run: RunState | null; scopeKey: string | null; projectId: string | undefined } {
  const storeRun = useLayoutStore((s) => s.run);
  const { projectId, worktreePath, projectPath } = useActiveIdentity();
  const scopeKey = activeLaunchScope(projectId, worktreePath, projectPath);
  const run = useMemo(() => filterRunByScope(storeRun, scopeKey), [storeRun, scopeKey]);
  return { run, scopeKey, projectId: projectId ?? undefined };
}
