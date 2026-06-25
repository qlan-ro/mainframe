import type { SessionItem } from './chat-to-thread-custom';
import { deriveSessionBadge, type SessionBase } from './session-status';

export type BaseStatusCounts = Record<SessionBase, number>;

export function countByBaseStatus(items: SessionItem[], unread: Set<string>): BaseStatusCounts {
  const counts: BaseStatusCounts = { 'worktree-missing': 0, working: 0, waiting: 0, idle: 0 };
  for (const item of items) {
    const { base } = deriveSessionBadge(item.custom, unread.has(item.id));
    counts[base] += 1;
  }
  return counts;
}
