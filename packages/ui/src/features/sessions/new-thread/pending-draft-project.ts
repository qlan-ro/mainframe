/**
 * pending-draft-project — a short-lived render gate for ChatSurface's
 * isInitializing branch on the no-pill new-session path.
 *
 * useStartNewSession stashes the resolved target here BEFORE switching to the
 * new thread, and clears it once the openNewThreadDraft sequence settles.
 * Module state, never persisted — a draft target must never survive a
 * restart. It is read only as a render gate; nothing seeds a draft's project
 * from it, so an archive-induced or boot draft can never inherit a stale
 * value.
 *
 * Ownership is token-based (todo #365): setPendingProject hands back a token,
 * and clearPendingProject only clears when that token still owns the stash.
 * Two New-session triggers in quick succession each get their own token, so
 * an earlier trigger's `finally` settling after a later trigger has already
 * stashed its own target can never clobber it.
 */
import { create } from 'zustand';

let nextToken = 0;

interface PendingDraftProjectState {
  projectId: string | null;
  token: number;
  setPendingProject: (id: string | null) => number;
  clearPendingProject: (token: number) => void;
}

export const usePendingDraftProject = create<PendingDraftProjectState>((set, get) => ({
  projectId: null,
  token: 0,
  setPendingProject: (id) => {
    const token = ++nextToken;
    set({ projectId: id, token });
    return token;
  },
  clearPendingProject: (token) => {
    if (get().token !== token) return;
    set({ projectId: null });
  },
}));

export function getPendingDraftProject(): string | null {
  return usePendingDraftProject.getState().projectId;
}
