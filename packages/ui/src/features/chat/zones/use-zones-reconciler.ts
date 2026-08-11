/**
 * Keeps the zones invariant: while split, `mainThreadId ∈ zones`.
 *
 * - Switching to a chat already in the split just moves focus to its slot.
 * - Switching to a chat outside the split replaces the focused slot with it
 *   (the plain-click-replaces-focused-pane rule).
 * - Switching to a draft (__LOCALID_*) closes the split — the new-session
 *   welcome flow owns the whole surface, and a draft cannot be a zone.
 *
 * Mounted once, by ChatSurface.
 */
import { useEffect } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useZonesStore, type ZoneIndex } from './zones-store';

export function useZonesReconciler(): void {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const zones = useZonesStore((s) => s.zones);

  useEffect(() => {
    if (zones == null || mainThreadId == null) return;
    const store = useZonesStore.getState();
    if (mainThreadId.startsWith('__LOCALID_')) {
      store.closeSplit();
      return;
    }
    const slot = zones.indexOf(mainThreadId);
    if (slot >= 0) {
      if (store.focusedIndex !== slot) store.setFocusedIndex(slot as ZoneIndex);
      return;
    }
    store.replaceZone(store.focusedIndex, mainThreadId);
  }, [zones, mainThreadId]);
}
