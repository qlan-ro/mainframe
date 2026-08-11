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
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useLayoutStore } from '@/store/layout';
import { useZonesStore, type ZoneIndex } from './zones-store';

export function useZonesReconciler(): void {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const zones = useZonesStore((s) => s.zones);

  // Workspace follower (split plan, decision 8): entering the split parks a
  // top-row workspace in the bottom strip; leaving it restores the workspace
  // unless the user repositioned things in between.
  const wasSplit = useRef(false);
  useEffect(() => {
    const split = zones != null;
    if (split && !wasSplit.current) useLayoutStore.getState().moveWorkspaceForChatSplit();
    if (!split && wasSplit.current) useLayoutStore.getState().restoreWorkspaceAfterChatSplit();
    wasSplit.current = split;
  }, [zones]);

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
