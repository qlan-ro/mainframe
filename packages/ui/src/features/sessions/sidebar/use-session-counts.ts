/**
 * useSessionCounts — projectId → live session count, for the new-session picker's
 * per-project count labels ("3 sessions"). Derived from the sidebar's own
 * unfiltered thread list so the picker never needs a second data source.
 */
import { useMemo } from 'react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';

export function useSessionCounts(items: SessionItem[]): Record<string, number> {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.custom.projectId] = (counts[item.custom.projectId] ?? 0) + 1;
    }
    return counts;
  }, [items]);
}
