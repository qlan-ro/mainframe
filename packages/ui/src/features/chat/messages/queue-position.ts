/**
 * queuePosition — derives a queued message's 1-based FIFO position + queue
 * total from the controller's live `interactions.queued` snapshot (design
 * 7.2: UMQueuedStack position/total → QueuedMeta's ordinal labels).
 *
 * Ordering is by `timestamp` ascending (oldest = position 1 = sends next).
 * A messageId absent from the queue (already sent / cancelled) degrades to
 * the single-item default so callers never crash on a stale render.
 */
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

export interface QueuePosition {
  readonly position: number;
  readonly total: number;
}

const DEFAULT_POSITION: QueuePosition = { position: 1, total: 1 };

export function queuePosition(queued: readonly QueuedMessageRef[], messageId: string): QueuePosition {
  if (queued.length === 0) return DEFAULT_POSITION;

  const ordered = [...queued].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const index = ordered.findIndex((ref) => ref.messageId === messageId);
  if (index === -1) return DEFAULT_POSITION;

  return { position: index + 1, total: ordered.length };
}
