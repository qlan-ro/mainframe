import { vi } from 'vitest';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';

/** Containers a page holds, as the daemon's default (`history_window::DEFAULT_CONTAINERS`). */
export const PAGE = 40;

/**
 * A finished sub-agent of `total` synthetic one-message containers (`m0` … `m{total-1}`), paged the
 * way the daemon pages one (`history_page::subagent_page`): no cursor is the newest page; `before`
 * ends a page at that item and `untilItemId` starts it there, else it starts a page earlier. The
 * floor is the page's first item. Stateless, like the daemon.
 */
export function fakeSubagentPager(total: number) {
  const id = (index: number) => `m${index}`;
  const at = (item: string) => Number(item.slice(1));
  const request = vi.fn(async (before?: string, until?: string): Promise<HistoryPageResult> => {
    if (before !== undefined && !(at(before) < total)) return { hasMore: false, stale: true };
    const end = before === undefined ? total : at(before);
    const start = before !== undefined && until !== undefined ? Math.min(at(until), end) : Math.max(0, end - PAGE);
    const updates = Array.from({ length: end - start }, (_, offset) => ({
      sessionUpdate: 'agent_message' as const,
      messageId: id(start + offset),
      content: [{ type: 'text' as const, text: `step ${start + offset}` }],
    }));
    return { hasMore: start > 0, ...(end > start && { floorItemId: id(start) }), updates };
  });
  return { request, id };
}
