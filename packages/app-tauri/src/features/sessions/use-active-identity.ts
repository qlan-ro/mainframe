/**
 * useActiveIdentity — the active session's project name + worktree branch for the
 * shell MainToolbar. Reads the active thread-list item's `custom` (narrowed once
 * via sessionCustomOf) for projectId + branchName, and resolves the project name
 * from the loaded project list. Runs inside the assistant-ui runtime provider.
 */
import { useAuiState } from '@assistant-ui/react';
import { useProjects } from './use-projects';
import { sessionCustomOf } from './view-model/chat-to-thread-custom';

export interface ActiveIdentity {
  projectName: string;
  branchName?: string;
  /** Active session's project id (for file-tree / git scoping). */
  projectId?: string;
  /** Active session's remote chat id (worktree-correct path resolution). */
  chatId?: string;
}

export function useActiveIdentity(): ActiveIdentity {
  const custom = useAuiState((s) => sessionCustomOf(s.threadListItem?.custom));
  const chatId = useAuiState((s) => s.threadListItem?.remoteId ?? undefined);
  const { projects } = useProjects();
  const project = custom?.projectId ? projects.find((p) => p.id === custom.projectId) : undefined;
  return {
    projectName: project?.name ?? 'Mainframe',
    branchName: custom?.branchName,
    projectId: custom?.projectId,
    chatId,
  };
}
