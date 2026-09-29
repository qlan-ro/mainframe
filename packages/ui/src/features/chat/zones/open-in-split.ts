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
import { isRegisteredSideChatId } from '@/features/side-chat/side-chat-ids';
import { splitVisible, useZonesStore } from './zones-store';

/**
 * Whether the gesture has anywhere to go — the same question `openInSplit`
 * answers by returning false, asked WITHOUT performing it. A menu offering the
 * action reads its disabled state from here, so the offer and the gesture can
 * never disagree about what is splittable.
 */
export function canOpenInSplit(
  zones: [string, string] | null,
  activeId: string | null | undefined,
  id: string,
): boolean {
  if (activeId == null || id === activeId || id.startsWith('__LOCALID_')) return false;
  if (isRegisteredSideChatId(id)) return false;
  if (!splitVisible(zones, activeId)) return !activeId.startsWith('__LOCALID_');
  return zones != null && !zones.includes(id);
}

export function openInSplit(activeId: string | null | undefined, id: string): boolean {
  const store = useZonesStore.getState();
  if (!canOpenInSplit(store.zones, activeId, id) || activeId == null) return false;
  if (!splitVisible(store.zones, activeId)) {
    store.openSplit(activeId, id);
    return true;
  }
  store.replaceZone(store.focusedIndex === 0 ? 1 : 0, id);
  return true;
}

/**
 * Show `id` beside `anchorId`, whatever is on screen now. A pair that already
 * holds the anchor keeps it and swaps its other slot to `id`; otherwise a
 * fresh pair opens with the anchor left. The caller decides focus.
 */
export function openBeside(anchorId: string, id: string): void {
  const store = useZonesStore.getState();
  const { zones } = store;
  if (zones != null && zones.includes(anchorId)) {
    if (!zones.includes(id)) store.replaceZone(zones[0] === anchorId ? 1 : 0, id);
    return;
  }
  store.openSplit(anchorId, id);
}

/**
 * The chat a new fork should open beside: its parent when the parent is on
 * screen (focused, or in the visible split), otherwise the chat the user is
 * looking at — pairing with an off-screen parent would show a pane that never
 * hydrated. Null (open the fork alone) when nothing real is focused.
 */
export function forkAnchor(
  parentId: string,
  mainThreadId: string | null | undefined,
  zones: [string, string] | null,
): string | null {
  if (mainThreadId == null || mainThreadId.startsWith('__LOCALID_')) return null;
  if (mainThreadId === parentId) return parentId;
  if (zones != null && splitVisible(zones, mainThreadId) && zones.includes(parentId)) return parentId;
  return mainThreadId;
}
