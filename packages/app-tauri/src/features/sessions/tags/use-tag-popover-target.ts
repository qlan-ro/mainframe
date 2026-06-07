/**
 * useTagPopoverTarget — which session row's Tag popover is open.
 *
 * A session row's "Tags" action calls open(chatId, currentTags); TagPopoverHost
 * (mounted once at the App root) reads this and renders the controlled popover.
 * Decouples Phase 5 rows from the popover wiring (no prop drilling).
 */
import { create } from 'zustand';

export interface TagPopoverTarget {
  chatId: string;
  currentTags: string[];
}

interface TagPopoverTargetState {
  target: TagPopoverTarget | null;
  open: (chatId: string, currentTags: string[]) => void;
  close: () => void;
}

export const useTagPopoverTarget = create<TagPopoverTargetState>((set) => ({
  target: null,
  open: (chatId, currentTags) => set({ target: { chatId, currentTags } }),
  close: () => set({ target: null }),
}));
