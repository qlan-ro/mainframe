import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

interface SentRow {
  timestamp: string;
  seen: boolean;
}

const byChat = new Map<string, Map<string, SentRow>>();

export function noteQueued(
  chatId: string,
  {
    queuedMessageId,
    timestamp,
  }: {
    queuedMessageId: string;
    timestamp: string;
  },
): void {
  const rows = byChat.get(chatId) ?? new Map<string, SentRow>();
  rows.set(queuedMessageId, { timestamp, seen: false });
  byChat.set(chatId, rows);
}

export function matchQueued(chatId: string, queue: readonly QueuedMessageRef[]): void {
  const rows = byChat.get(chatId);
  if (!rows) return;
  const inQueue = new Set(queue.map((ref) => ref.messageId));
  for (const [id, row] of rows) {
    if (inQueue.has(id)) row.seen = true;
    else if (row.seen) rows.delete(id);
  }
  if (!rows.size) byChat.delete(chatId);
}

export function heldTimestamp(chatId: string, messageId: string): string | undefined {
  return byChat.get(chatId)?.get(messageId)?.timestamp;
}

export function forgetSent(chatId: string): void {
  byChat.delete(chatId);
}
