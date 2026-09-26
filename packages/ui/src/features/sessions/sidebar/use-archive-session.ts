/**
 * useArchiveSession — the sidebar row's archive action.
 *
 * Asks about the worktree first (only when there IS one), then hands the answer
 * to the adapter through the confirm bridge and lets aui run the archive. Order
 * matters: aui switches the active thread away optimistically as soon as
 * archive() is called, so the question has to be settled before that — otherwise
 * the selection moves while the dialog is still open, and a cancel leaves the
 * user on an empty draft instead of the session they chose to keep.
 *
 * A temporary chat (todo #346) skips the ask entirely — it never has a worktree
 * question — and stages a discard instead of a worktree choice; the adapter's
 * `archiveWithStagedChoice` reads that flag and calls `discardChat` instead of
 * `archiveChat`, since the daemon 409s an archive of a temporary chat.
 *
 * Routed through `threadListItem.delete()`, not `.archive()`: aui's `archive()` only flags the local entry
 * `status: 'archived'` and keeps it in `threadData` forever, so a discarded
 * chat — gone server-side — would linger as a "restorable" archived row
 * (404s on Restore), stay in the Spotlight palette, and never prune its layout
 * entry. `delete()` removes the entry from `threadData`/`threadIdMap`
 * outright, which is what a discard actually is.
 *
 * The temporary-discard branch guards against a double-click's second call:
 * staging alone isn't enough — for a
 * NON-active row, aui's `delete()` removes the row from local state
 * SYNCHRONOUSLY and the adapter consumes the staged flag on its way to
 * `discardChat`, both before the first call's network request ever settles.
 * By the time a fast second click runs, the flag is already gone, so it would
 * stage and call `delete()` again against a row aui no longer has — which
 * throws, surfacing a spurious error toast for a discard that already
 * succeeded. `discardsStarted` (module-level, keyed by remoteId) guards the
 * whole call instead of the staged flag's take/consume timing: once a discard
 * is under way for a remoteId, every other call for it is a no-op until this
 * one's `delete()` SETTLES. A failure clears the entry so a genuine retry
 * (the user clicking again after seeing the error, not a double-click) still
 * goes through.
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import {
  requestWorktreeArchiveChoice,
  stageArchiveChoice,
  stageDiscard,
  takeDiscard,
} from '../runtime/archive-confirm-bridge';

/** remoteIds with a discard currently in flight — cleared only on failure (see module docstring). */
const discardsStarted = new Set<string>();

/** Test seam — drain a remoteId between cases, mirroring ghost-chat-queue's clear helper. */
export function clearDiscardStarted(remoteId: string): void {
  discardsStarted.delete(remoteId);
}

export function useArchiveSession(remoteId: string, hasWorktree: boolean, temporary: boolean): () => void {
  const aui = useAui();

  return useCallback(() => {
    void (async () => {
      if (temporary) {
        if (discardsStarted.has(remoteId)) return; // already discarding — a double-click's second call
        discardsStarted.add(remoteId);
        stageDiscard(remoteId);
        try {
          await aui.threadListItem.delete();
        } catch (err: unknown) {
          discardsStarted.delete(remoteId); // let a genuine (non-double-click) retry through
          console.warn('[useArchiveSession] discard failed', { remoteId, err });
          mfToast.error('Could not discard the chat', {
            description: err instanceof Error ? err.message : 'Try again.',
          });
        } finally {
          // If aui threw before the adapter ever consumed the flag (e.g. a
          // status guard on the core), clear it here — otherwise it leaks in
          // the staged-discard set forever. A no-op once the
          // adapter already consumed it.
          takeDiscard(remoteId);
        }
        return;
      }
      let choice = { deleteWorktree: false };
      if (hasWorktree) {
        const answer = await requestWorktreeArchiveChoice(remoteId);
        if (answer === 'cancel') return;
        choice = answer;
      }
      stageArchiveChoice(remoteId, choice);
      await aui.threadListItem.archive();
    })();
  }, [remoteId, hasWorktree, temporary, aui]);
}
