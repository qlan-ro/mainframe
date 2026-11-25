/**
 * Where a held message stood before "Send now" queued it with the agent. The
 * daemon gives it a new id and a new time, so a Stop that takes it back would
 * line it up behind the rows that never went out (C10). Kept by its text until
 * it is seen in the agent's queue, then by its id; in memory only.
 */
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

interface SentRow {
  content: string;
  attachmentIds?: string[];
  /** Its time in the held queue. */
  timestamp: string;
  /** In the agent's queue, once seen there. */
  messageId?: string;
}

const byChat = new Map<string, SentRow[]>();

const ids = (row: { attachmentIds?: string[] }): string => (row.attachmentIds ?? []).join(',');
const isSame = (row: SentRow, ref: QueuedMessageRef): boolean =>
  ids(row) === ids(ref) && (row.content === ref.content || ids(row) !== '');

/** A held row the daemon queued. */
export function noteQueued(chatId: string, { content, attachmentIds, timestamp }: SentRow): void {
  byChat.set(chatId, [...(byChat.get(chatId) ?? []), { content, attachmentIds, timestamp }]);
}

/** Finds the noted rows in the agent's queue, oldest first; one that has left it is forgotten. */
export function matchQueued(chatId: string, queue: readonly QueuedMessageRef[]): void {
  const noted = byChat.get(chatId);
  if (!noted) return;
  const inQueue = new Set(queue.map((ref) => ref.messageId));
  const rows = noted.filter((row) => row.messageId === undefined || inQueue.has(row.messageId));
  const taken = new Set(rows.map((row) => row.messageId));
  for (const ref of [...queue].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (taken.has(ref.messageId)) continue;
    const row = rows.find((candidate) => candidate.messageId === undefined && isSame(candidate, ref));
    if (row) row.messageId = ref.messageId;
  }
  byChat.set(chatId, rows);
}

/** The time the message had in the held queue, if that is where it came from. */
export function heldTimestamp(chatId: string, messageId: string): string | undefined {
  return byChat.get(chatId)?.find((row) => row.messageId === messageId)?.timestamp;
}

export function forgetSent(chatId: string): void {
  byChat.delete(chatId);
}
