/**
 * Split-view zones — the capped two-zone split inside the chat surface
 * (docs/plans/2026-08-11-split-chat-zones.md).
 *
 * Zone ids are aui item ids (the same id space the session-tab store uses).
 * `mainThreadId` stays the single focus axis: while split it must be a member
 * of `zones` — use-zones-reconciler enforces that by replacing the focused
 * slot when a switch lands on a chat outside the split (the Claude Code
 * desktop rule: "clicking another session replaces whichever pane has focus").
 */
import { create } from 'zustand';

export type ZoneIndex = 0 | 1;

interface ZonesState {
  /** The two visible chats, left to right; null = single-zone (no split). */
  zones: [string, string] | null;
  /** The slot `mainThreadId` occupies — the slot a tab switch replaces. */
  focusedIndex: ZoneIndex;
  /** Opens the split with the current chat left and `second` right; focus stays left. */
  openSplit: (first: string, second: string) => void;
  replaceZone: (index: ZoneIndex, id: string) => void;
  setFocusedIndex: (index: ZoneIndex) => void;
  closeSplit: () => void;
}

export const useZonesStore = create<ZonesState>((set) => ({
  zones: null,
  focusedIndex: 0,
  openSplit: (first, second) => set({ zones: [first, second], focusedIndex: 0 }),
  replaceZone: (index, id) =>
    set((s) => {
      if (s.zones == null || s.zones.includes(id)) return s;
      return { zones: index === 0 ? [id, s.zones[1]] : [s.zones[0], id] };
    }),
  setFocusedIndex: (index) => set({ focusedIndex: index }),
  closeSplit: () => set({ zones: null, focusedIndex: 0 }),
}));

/** A chat is visible while split iff it holds one of the two slots. */
export function isVisibleZone(zones: [string, string] | null, id: string | null | undefined): boolean {
  return id != null && zones != null && zones.includes(id);
}
