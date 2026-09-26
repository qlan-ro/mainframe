/**
 * Archive-confirm bridge (D10) — the seam between the archive confirm dialog,
 * the row that triggers an archive, and the daemon adapter.
 *
 * Two halves, both needed because native ThreadListItemPrimitive.Archive calls
 * adapter.archive(remoteId) with NO payload while our daemon archive takes a
 * deleteWorktree flag:
 *
 *   - `request` / `resolve`: the ASK. The row calls `request` (sets `pending`,
 *     which the dialog renders) and awaits the user's button click.
 *   - `stageArchiveChoice` / `takeArchiveChoice`: the HANDOFF. The row stages the
 *     answered choice under the chat id, then invokes aui's archive; the adapter
 *     consumes it on its way to the daemon.
 *
 * The ask deliberately happens BEFORE aui's archive, not inside the adapter:
 * aui switches the active thread away optimistically the moment archive() is
 * called, so prompting from the adapter changed the user's selected session
 * while the confirm dialog was still open — and cancelling then stranded them on
 * an empty draft rather than the session they kept. Asking first means a cancel
 * never reaches aui at all: nothing moves.
 *
 * Only worktree-backed sessions are ever asked (the question IS the worktree),
 * so `pending` carries no hasWorktree flag — its presence means "has one".
 *
 * A third staging slot, `stageDiscard`/`takeDiscard`, carries a different
 * per-chat choice through the same seam: a temporary chat 409s on archive
 * (todo #346), so the row stages "this archive is really a discard" instead of
 * a worktree choice, and the adapter's `archiveWithStagedChoice` routes to
 * `discardChat` when it finds one staged.
 */
import { create } from 'zustand';

export type ArchiveChoice = { deleteWorktree: boolean } | 'cancel';

export interface PendingArchiveRequest {
  remoteId: string;
}

interface ArchivePromptState {
  pending: PendingArchiveRequest | null;
  request: (remoteId: string) => Promise<ArchiveChoice>;
  resolve: (choice: ArchiveChoice) => void;
}

let resolver: ((choice: ArchiveChoice) => void) | null = null;

export const useArchivePrompt = create<ArchivePromptState>((set, get) => ({
  pending: null,
  request: (remoteId) => {
    return new Promise<ArchiveChoice>((res) => {
      // One prompt at a time: a second request displaces the first. Resolve the
      // stranded resolver with 'cancel' so its caller abandons that archive
      // instead of hanging forever.
      const displaced = resolver;
      resolver = res;
      set({ pending: { remoteId } });
      displaced?.('cancel');
    });
  },
  resolve: (choice) => {
    const r = resolver;
    if (!get().pending || !r) return;
    resolver = null;
    set({ pending: null });
    r(choice);
  },
}));

/** Thin wrapper the row calls. Resolves with the dialog's choice. */
export function requestWorktreeArchiveChoice(remoteId: string): Promise<ArchiveChoice> {
  return useArchivePrompt.getState().request(remoteId);
}

const staged = new Map<string, { deleteWorktree: boolean }>();

/** Record the answered choice for the archive aui is about to route to the adapter. */
export function stageArchiveChoice(remoteId: string, choice: { deleteWorktree: boolean }): void {
  staged.set(remoteId, choice);
}

/** Consume a staged choice. Undefined when the archive came from a path that never asks. */
export function takeArchiveChoice(remoteId: string): { deleteWorktree: boolean } | undefined {
  const choice = staged.get(remoteId);
  staged.delete(remoteId);
  return choice;
}

const discardStaged = new Set<string>();

/** Mark the archive about to run for `remoteId` as a temporary-chat discard, not a worktree archive (todo #346). */
export function stageDiscard(remoteId: string): void {
  discardStaged.add(remoteId);
}

/** Consume the staged discard flag. False for the normal (non-temporary) archive path. */
export function takeDiscard(remoteId: string): boolean {
  return discardStaged.delete(remoteId);
}

const localOnlyRemovalStaged = new Set<string>();

/**
 * Mark the delete about to run for `remoteId` as already handled server-side —
 * the ghost-chat prune (todo #346) reaches this when a discard ran
 * OUTSIDE any row/aui interaction (new-thread-coordinator's abandon cleanup),
 * so the daemon copy is already gone by the time aui's local stale entry is
 * cleaned up. The adapter must skip the network call entirely (a repeat
 * discard/archive of an already-gone chat would 404 and, since aui reverts an
 * optimistic delete on rejection, leave the ghost row in place forever).
 */
export function stageLocalOnlyRemoval(remoteId: string): void {
  localOnlyRemovalStaged.add(remoteId);
}

/** Consume the staged local-only flag. False for every normal archive/delete path. */
export function takeLocalOnlyRemoval(remoteId: string): boolean {
  return localOnlyRemovalStaged.delete(remoteId);
}
