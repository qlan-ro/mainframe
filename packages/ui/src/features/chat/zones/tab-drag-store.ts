/**
 * Live state of a session-tab drag (the drag-to-split gesture). The pill
 * starts/ends it from pointer events; ZoneDropLayer renders drop targets over
 * the chat surface while it is active. Transient by nature — never persisted.
 */
import { create } from 'zustand';

interface TabDragState {
  /** The tab being dragged, or null when no drag is live. */
  draggingId: string | null;
  start: (id: string) => void;
  end: () => void;
}

export const useTabDragStore = create<TabDragState>((set) => ({
  draggingId: null,
  start: (id) => set({ draggingId: id }),
  end: () => set({ draggingId: null }),
}));
