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
  /** Viewport rect of the trigger (the row's Tags button) — the host anchors the
   *  popover to it. The host is mounted at the app root, decoupled from the row,
   *  so without an anchor the Radix popover renders off-screen at (0,0). */
  anchorRect: DOMRect | null;
}

interface TagPopoverTargetState {
  target: TagPopoverTarget | null;
  open: (chatId: string, currentTags: string[], anchorRect: DOMRect | null) => void;
  close: () => void;
}

export const useTagPopoverTarget = create<TagPopoverTargetState>((set) => ({
  target: null,
  open: (chatId, currentTags, anchorRect) => set({ target: { chatId, currentTags, anchorRect } }),
  close: () => set({ target: null }),
}));
