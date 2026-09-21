/**
 * pending-draft-project — a short-lived render gate for ChatSurface's
 * isInitializing branch on the no-pill new-session path.
 *
 * useStartNewSession stashes the resolved target here BEFORE switching to the
 * new thread, and clears it once the openNewThreadDraft sequence settles.
 * Module state, never persisted — a draft target must never survive a
 * restart — and only the action that sets it clears it. It is read only as a
 * render gate; nothing seeds a draft's project from it, so an archive-induced
 * or boot draft can never inherit a stale value.
 */
import { create } from 'zustand';

interface PendingDraftProjectState {
  projectId: string | null;
  setPendingProject: (id: string | null) => void;
  clearPendingProject: () => void;
}

export const usePendingDraftProject = create<PendingDraftProjectState>((set) => ({
  projectId: null,
  setPendingProject: (id) => set({ projectId: id }),
  clearPendingProject: () => set({ projectId: null }),
}));

export function getPendingDraftProject(): string | null {
  return usePendingDraftProject.getState().projectId;
}
