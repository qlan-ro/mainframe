/**
 * Split-view zones — the capped two-zone split inside the chat surface
 * (docs/plans/2026-08-11-split-chat-zones.md).
 *
 * Zone ids are aui item ids (the same id space the session-tab store uses).
 * The pair is an ARRANGEMENT, not a lock on navigation: the split renders
 * only while `mainThreadId` is a member (`splitVisible`). Switching to any
 * other session PARKS it — normal single-chat view, pair kept — and clicking
 * either member's tab brings it back. (This replaced the Claude Code desktop
 * replace-the-focused-pane rule after live use: a plain click must never
 * rewrite the pair.) Only explicit gestures edit it: ⌘-click/drag retarget,
 * the zone ✕ / a member tab's ✕ / ⌘\\ dissolve it.
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

/** A chat holds one of the two slots. */
export function isVisibleZone(zones: [string, string] | null, id: string | null | undefined): boolean {
  return id != null && zones != null && zones.includes(id);
}

/** The split RENDERS only while the focused chat is a member; otherwise the
 *  pair is parked behind the normal single-chat view. */
export function splitVisible(zones: [string, string] | null, mainThreadId: string | null | undefined): boolean {
  return isVisibleZone(zones, mainThreadId);
}
