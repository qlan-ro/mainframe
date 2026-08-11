/**
 * The one open-in-split gesture, shared by the tab strip's ⌘-click, the
 * sidebar's ⌘-click and its context-menu action.
 *
 * Returns true when the split absorbed the gesture (opened, or retargeted the
 * unfocused slot) — the caller then skips its plain focus switch. False means
 * fall through: the target is the active chat, a draft, already a visible
 * zone (a focus click), or the active chat is a draft that cannot anchor a
 * split.
 */
import { useZonesStore } from './zones-store';

export function openInSplit(activeId: string | null | undefined, id: string): boolean {
  if (activeId == null || id === activeId || id.startsWith('__LOCALID_')) return false;
  const store = useZonesStore.getState();
  if (store.zones == null) {
    if (activeId.startsWith('__LOCALID_')) return false;
    store.openSplit(activeId, id);
    return true;
  }
  if (store.zones.includes(id)) return false;
  store.replaceZone(store.focusedIndex === 0 ? 1 : 0, id);
  return true;
}
