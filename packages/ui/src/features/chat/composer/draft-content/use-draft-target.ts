import { useSyncExternalStore } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { getActiveDaemon, subscribeActiveDaemon } from '@/lib/daemon/active-daemon';
import { useDraftConfig } from '@/features/sessions/runtime/draft-config';
import { useProjectsStore } from '@/store/projects';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import type { ChatRuntimeExtras } from '../../runtime/chat-extras';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { partitionDraftItems, type DraftTarget } from './draft-target';
import { useDraftItems } from './draft-content-store';

export function useDraftTarget(): DraftTarget {
  const threadId = useActiveThreadId();
  const draft = useDraftConfig(threadId ?? null);
  const chat = useAuiState((s) => (s.thread?.extras as ChatRuntimeExtras | undefined)?.state?.chatConfig);
  const custom = useAuiState((s) => s.threadListItem?.custom as SessionCustom | undefined);
  const projectId = draft ? draft.projectId : chat?.noProject ? null : (chat?.projectId ?? custom?.projectId ?? null);
  const project = useProjectsStore((s) => s.projects.find(({ id }) => id === projectId));
  const daemon = useSyncExternalStore(subscribeActiveDaemon, getActiveDaemon);
  return {
    daemonId: daemon.id,
    projectId,
    projectName: project?.name,
    projectPath: project?.path,
    worktreePath: draft ? draft.worktreePath : (chat?.worktreePath ?? custom?.worktreePath),
    pendingBranch: draft?.pendingWorktree?.branchName,
  };
}

export function useActiveDraftItems(threadId: string | undefined) {
  return partitionDraftItems(useDraftItems(threadId), useDraftTarget()).active;
}
