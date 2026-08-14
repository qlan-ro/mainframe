/**
 * "Which number does ⌃N give this session?" — for surfaces outside the strip.
 *
 * The sidebar lists every session, but only the open tabs answer to a chord,
 * so a row's badge is its position in the SAME displayed order the strip
 * paints. Reading `displayedTabIds` here rather than mirroring its rules is
 * what keeps the two from drifting: a regrouped split reorders both at once.
 */
import { useMemo } from 'react';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { useIndexHintsStore } from '@/features/shortcuts/index-hints';
import { useSessionTabsStore } from './store';
import { displayedTabIds, tabHintIndex } from './tabs-model';

/** The badge number for a session, or null when it has none to show. */
export function useTabHintIndex(sessionId: string): number | null {
  const revealed = useIndexHintsStore((s) => s.revealed);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const draftId = useSessionTabsStore((s) => s.draftId);
  const zones = useZonesStore((s) => s.zones);

  return useMemo(() => {
    if (!revealed) return null;
    // `displayedTabIds` ignores its third argument, so the sidebar resolves the
    // order without reaching for assistant-ui's active thread.
    return tabHintIndex(displayedTabIds({ tabIds, previewId, draftId }, zones, null), sessionId);
  }, [revealed, tabIds, previewId, draftId, zones, sessionId]);
}
