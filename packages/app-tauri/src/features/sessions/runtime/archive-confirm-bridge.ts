/**
 * Archive-confirm bridge (D10 / S5) — a zustand store the adapter and the
 * ArchiveWorktreeDialog share.
 *
 * Native ThreadListItemPrimitive.Archive calls adapter.archive(remoteId) with
 * NO payload, but our daemon archive takes a deleteWorktree flag. So the adapter
 * awaits this bridge: `request` sets `pending` (the dialog renders it) and
 * returns a promise; the user's button click calls `resolve(choice)`. A
 * 'cancel' makes the adapter throw so aui rolls back the optimistic archive (S5).
 *
 * `hasWorktree` is passed in by the adapter caller (which derives it via getChat)
 * — the dialog uses it to decide whether to offer the "delete worktree" option.
 */
import { create } from 'zustand';

export type ArchiveChoice = { deleteWorktree: boolean } | 'cancel';

export interface PendingArchiveRequest {
  remoteId: string;
  hasWorktree: boolean;
}

interface ArchivePromptState {
  pending: PendingArchiveRequest | null;
  request: (remoteId: string, opts: { hasWorktree: boolean }) => Promise<ArchiveChoice>;
  resolve: (choice: ArchiveChoice) => void;
}

let resolver: ((choice: ArchiveChoice) => void) | null = null;

export const useArchivePrompt = create<ArchivePromptState>((set, get) => ({
  pending: null,
  request: (remoteId, opts) => {
    return new Promise<ArchiveChoice>((res) => {
      resolver = res;
      set({ pending: { remoteId, hasWorktree: opts.hasWorktree } });
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

/** Thin wrapper the adapter calls. Resolves with the dialog's choice. */
export function requestWorktreeArchiveChoice(remoteId: string, opts: { hasWorktree: boolean }): Promise<ArchiveChoice> {
  return useArchivePrompt.getState().request(remoteId, opts);
}
