/**
 * Split followers. The pair itself is never rewritten by navigation (parking
 * model — see zones-store): this hook only
 *
 * - tracks which slot holds focus while the split is visible, so gestures that
 *   target "the focused/unfocused slot" (⌘-click retarget, ⌘\\) aim right, and
 * - drives the workspace auto-park on VISIBILITY transitions: entering the
 *   visible split parks a top-row workspace in the bottom strip, leaving it
 *   (parking the split or dissolving it) restores the workspace unless the
 *   user repositioned things in between.
 *
 * Mounted once, by ChatSurface.
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useLayoutStore } from '@/store/layout';
import { splitVisible, useZonesStore, type ZoneIndex } from './zones-store';

export function useZonesReconciler(): void {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const zones = useZonesStore((s) => s.zones);
  const visible = splitVisible(zones, mainThreadId);

  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) useLayoutStore.getState().moveWorkspaceForChatSplit();
    if (!visible && wasVisible.current) useLayoutStore.getState().restoreWorkspaceAfterChatSplit();
    wasVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    if (zones == null || mainThreadId == null) return;
    const slot = zones.indexOf(mainThreadId);
    if (slot >= 0 && useZonesStore.getState().focusedIndex !== slot) {
      useZonesStore.getState().setFocusedIndex(slot as ZoneIndex);
    }
  }, [zones, mainThreadId]);
}
