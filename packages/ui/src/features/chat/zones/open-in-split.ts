/**
 * The one open-in-split gesture, shared by the tab strip's ⌘-click, the
 * sidebar's ⌘-click and its context-menu action: "show this session BESIDE
 * the chat I'm looking at".
 *
 * With the split VISIBLE it retargets the unfocused slot. With no split — or
 * a parked pair, which the user has navigated away from — it opens a fresh
 * pair anchored on the active chat (overwriting a parked one: the gesture is
 * about what is on screen NOW).
 *
 * Returns true when the split absorbed the gesture — the caller then skips
 * its plain focus switch. False means fall through: the target is the active
 * chat, a draft, already a member of the visible split (a focus click), or
 * the active chat is a draft that cannot anchor a split.
 */
import { splitVisible, useZonesStore } from './zones-store';

export function openInSplit(activeId: string | null | undefined, id: string): boolean {
  if (activeId == null || id === activeId || id.startsWith('__LOCALID_')) return false;
  const store = useZonesStore.getState();
  if (!splitVisible(store.zones, activeId)) {
    if (activeId.startsWith('__LOCALID_')) return false;
    store.openSplit(activeId, id);
    return true;
  }
  if (store.zones != null && store.zones.includes(id)) return false;
  store.replaceZone(store.focusedIndex === 0 ? 1 : 0, id);
  return true;
}
