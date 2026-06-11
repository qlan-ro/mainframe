/**
 * useActiveBases — derives and syncs the active workspace bases into the
 * active-bases store so the intent subscriber (which runs outside React) can
 * read them when normalizing open-file path flavors.
 *
 * Sources:
 *   worktreePath — from the active thread's SessionCustom (via useAuiState)
 *   projectPath  — from the loaded Project record (via useProjects + projectId)
 *
 * Usage: mount once inside the AssistantRuntimeProvider (e.g. in RuntimeBody
 * inside AppShell). No return value — the side-effect is the store push.
 */
import { useEffect } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useProjects } from './use-projects';
import { sessionCustomOf } from './view-model/chat-to-thread-custom';
import { useActiveBasesStore } from '@/store/active-bases-store';

export function useActiveBases(): void {
  const custom = useAuiState((s) => sessionCustomOf(s.threadListItem?.custom));
  const { projects } = useProjects();

  const worktreePath = custom?.worktreePath;
  const projectId = custom?.projectId;
  const projectPath = projectId ? (projects.find((p) => p.id === projectId)?.path ?? undefined) : undefined;

  const setActiveBases = useActiveBasesStore((s) => s.setActiveBases);

  useEffect(() => {
    setActiveBases({ worktreePath, projectPath });
  }, [worktreePath, projectPath, setActiveBases]);
}
