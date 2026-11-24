/**
 * "Which number does ⌘N give this session?" — for surfaces outside the strip.
 *
 * The sidebar lists every session, but only the open tabs answer to a chord,
 * so a row's badge is its position in the SAME displayed order the strip
 * paints. Reading `displayedTabIds` here rather than mirroring its rules is
 * what keeps the two from drifting.
 */
import { useMemo } from 'react';
import { useIndexHintsStore } from '@/features/shortcuts/index-hints';
import { useSessionTabsStore } from './store';
import { displayedTabIds, tabHintIndex } from './tabs-model';

/** The badge number for a session, or null when it has none to show. */
export function useTabHintIndex(sessionId: string): number | null {
  const revealed = useIndexHintsStore((s) => s.revealed);
  const tabIds = useSessionTabsStore((s) => s.tabIds);
  const previewId = useSessionTabsStore((s) => s.previewId);
  const draftId = useSessionTabsStore((s) => s.draftId);

  return useMemo(() => {
    if (!revealed) return null;
    return tabHintIndex(displayedTabIds({ tabIds, previewId, draftId }), sessionId);
  }, [revealed, tabIds, previewId, draftId, sessionId]);
}
