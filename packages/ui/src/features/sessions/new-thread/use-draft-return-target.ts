/**
 * Remembers the session that was active when a draft was started, so discarding
 * the draft (✕ or navigating away unsent) can restore the previous selection.
 * Set at every draft-creation entry point ("+" popover pick, pill-active "+", ⌘N).
 */
import { create } from 'zustand';

interface DraftReturnTargetState {
  returnThreadId: string | null;
  setReturnTarget: (id: string | null) => void;
  clear: () => void;
}

export const useDraftReturnTarget = create<DraftReturnTargetState>((set) => ({
  returnThreadId: null,
  setReturnTarget: (id) => set({ returnThreadId: id }),
  clear: () => set({ returnThreadId: null }),
}));
