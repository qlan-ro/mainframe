/**
 * useArchiveSession — the sidebar row's archive action.
 *
 * Asks about the worktree first (only when there IS one), then hands the answer
 * to the adapter through the confirm bridge and lets aui run the archive. Order
 * matters: aui switches the active thread away optimistically as soon as
 * archive() is called, so the question has to be settled before that — otherwise
 * the selection moves while the dialog is still open, and a cancel leaves the
 * user on an empty draft instead of the session they chose to keep.
 */
import { useCallback } from 'react';
import { useThreadListItemRuntime } from '@assistant-ui/react';
import { requestWorktreeArchiveChoice, stageArchiveChoice } from '../runtime/archive-confirm-bridge';

export function useArchiveSession(remoteId: string, hasWorktree: boolean): () => void {
  const itemRuntime = useThreadListItemRuntime();

  return useCallback(() => {
    void (async () => {
      let choice = { deleteWorktree: false };
      if (hasWorktree) {
        const answer = await requestWorktreeArchiveChoice(remoteId);
        if (answer === 'cancel') return;
        choice = answer;
      }
      stageArchiveChoice(remoteId, choice);
      await itemRuntime.archive();
    })();
  }, [remoteId, hasWorktree, itemRuntime]);
}
