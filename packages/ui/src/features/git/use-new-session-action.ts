/**
 * useNewSessionAction — BranchPopover's "new session in worktree" action.
 *
 * Resolves the adapter for the created chat from the active thread's custom,
 * else the pre-send draft config (a `__LOCALID_*` thread has no custom yet),
 * falling back to 'claude' — then creates the worktree-scoped session and
 * closes the popover via `onDone`.
 */
import { useCallback } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { activeSessionCustom } from '../sessions/view-model/chat-to-thread-custom';
import { useActiveDraftConfig } from '../sessions/use-active-draft-config';
import { useWorktreeSession } from './use-worktree-session';

const DEFAULT_ADAPTER_ID = 'claude';

export function useNewSessionAction(
  port: number,
  projectId: string | undefined,
  onDone: () => void,
): (worktreeDirName: string, branchName?: string) => void {
  const customAdapterId = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems)?.adapterId);
  const draft = useActiveDraftConfig();
  const adapterId = customAdapterId ?? draft?.adapterId ?? DEFAULT_ADAPTER_ID;

  const newSession = useWorktreeSession(port, projectId, adapterId);
  return useCallback(
    (worktreeDirName: string, branchName?: string) => {
      void newSession(worktreeDirName, branchName);
      onDone();
    },
    [newSession, onDone],
  );
}
