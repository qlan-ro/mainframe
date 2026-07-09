/**
 * useWorktreeSession — creates a new daemon chat scoped to a worktree and
 * switches the sessions runtime to it.
 *
 * The caller resolves `adapterId` from the active thread's `custom.adapterId`
 * (via activeSessionCustom) with `'claude'` as the fallback — it is REQUIRED by
 * createChat's CreateChatBody. Passed as an arg rather than read here so the
 * hook remains runtime-provider-free (simpler to test).
 */
import { useCallback } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { createChat } from '@/lib/api/chats';
import { getProjectWorktrees } from '@/lib/api/git';
import { resolveWorktree } from './worktree-resolve';

export function useWorktreeSession(port: number, projectId: string | undefined, adapterId: string) {
  const runtime = useAssistantRuntime();
  return useCallback(
    async (worktreeDirName: string, branchName?: string): Promise<void> => {
      if (!projectId) return;
      const worktrees = await getProjectWorktrees(port, projectId);
      const wt = resolveWorktree(worktrees, { dirName: worktreeDirName, branchName });
      if (!wt) return;
      const chat = await createChat(port, {
        projectId,
        adapterId,
        worktreePath: wt.path,
        ...(branchName ? { branchName } : {}),
      });
      await runtime.threads.reload();
      // chat.id IS the remoteId; the reload resolves the new chat into a thread
      // whose thread-list item carries `remoteId === chat.id`. switchToThread
      // takes the item.id (= remoteId for remote threads), same contract as
      // SearchPalette's precedent (use-active-identity.ts:29 / A10).
      runtime.threads.switchToThread(chat.id);
    },
    [port, projectId, adapterId, runtime],
  );
}
