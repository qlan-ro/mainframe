/**
 * Split followers. The pair itself is never rewritten by navigation (parking
 * model — see zones-store): this hook only
 *
 * - tracks which slot holds focus while the split is visible, so gestures that
 *   target "the focused/unfocused slot" (⌘-click retarget, ⌘\\) aim right, and
 * - drives the workspace auto-park on MEMBERSHIP transitions: focusing a
 *   member of the pair parks a top-row workspace in the bottom strip, leaving
 *   it (focusing another chat or dissolving the pair) restores the workspace
 *   unless the user repositioned things in between — a split parked only for
 *   width keeps the workspace parked, so widening brings the split back, and
 * - opens a queued `pendingPair` once its second chat is in the thread list.
 *
 * Mounted once, by ChatSurface.
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { registerChatSplitVisibleProbe, useLayoutStore } from '@/store/layout';
import { openBeside } from './open-in-split';
import { splitVisible, useZonesStore, type ZoneIndex } from './zones-store';

// The layout store's workspace placement is split-aware through this probe
// (store/ cannot import features/, so the dependency is inverted). Module
// scope: the reconciler is imported by ChatSurface, which always mounts.
let splitVisibleNow = false;
registerChatSplitVisibleProbe(() => splitVisibleNow);

export function useZonesReconciler(): void {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const zones = useZonesStore((s) => s.zones);
  // Membership only, NOT `splitFits`: the parked workspace is what frees the
  // width the split needs. Gating on fit made a narrow window park the split,
  // restore the workspace beside the chat, and keep the surface too narrow for
  // the split ever to come back after the window widened again.
  const visible = splitVisible(zones, mainThreadId);
  splitVisibleNow = visible;

  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) useLayoutStore.getState().moveWorkspaceForChatSplit();
    if (!visible && wasVisible.current) useLayoutStore.getState().restoreWorkspaceAfterChatSplit();
    wasVisible.current = visible;
  }, [visible]);

  const pendingPair = useZonesStore((s) => s.pendingPair);
  const pendingListed = useAuiState(
    (s) => pendingPair != null && s.threads.threadItems.some((t) => t.id === pendingPair[1]),
  );
  useEffect(() => {
    if (pendingPair == null || !pendingListed) return;
    useZonesStore.setState({ pendingPair: null });
    openBeside(pendingPair[0], pendingPair[1]);
  }, [pendingPair, pendingListed]);

  useEffect(() => {
    if (zones == null || mainThreadId == null) return;
    const slot = zones.indexOf(mainThreadId);
    if (slot >= 0 && useZonesStore.getState().focusedIndex !== slot) {
      useZonesStore.getState().setFocusedIndex(slot as ZoneIndex);
    }
  }, [zones, mainThreadId]);
}
