/**
 * queuePosition — derives a queued message's 1-based FIFO position + queue
 * total from the controller's live `interactions.queued` snapshot (design
 * 7.2: UMQueuedStack position/total → QueuedMeta's ordinal labels).
 *
 * Ordering is by `timestamp` ascending (oldest = position 1 = consumed next by the CLI).
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

  // localeCompare here is a plain ASCII compare over fixed-format ISO-8601
  // timestamps (e.g. "2026-07-02T10:15:30.000Z") — lexicographic order matches
  // chronological order for that format. This relies on string-format
  // stability, not locale-aware collation (no locale/options args are passed).
  const ordered = [...queued].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const index = ordered.findIndex((ref) => ref.messageId === messageId);
  if (index === -1) return DEFAULT_POSITION;

  return { position: index + 1, total: ordered.length };
}
