import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

interface SentRow {
  timestamp: string;
  seen: boolean;
}

const byChat = new Map<string, Map<string, SentRow>>();
const chatKey = (chatId: string, daemonId = getActiveDaemon().id) => JSON.stringify([daemonId, chatId]);

export function noteQueued(
  chatId: string,
  {
    queuedMessageId,
    timestamp,
  }: {
    queuedMessageId: string;
    timestamp: string;
  },
  daemonId?: string,
): void {
  const key = chatKey(chatId, daemonId);
  const rows = byChat.get(key) ?? new Map<string, SentRow>();
  rows.set(queuedMessageId, { timestamp, seen: false });
  byChat.set(key, rows);
}

export function matchQueued(chatId: string, queue: readonly QueuedMessageRef[], daemonId?: string): void {
  const key = chatKey(chatId, daemonId);
  const rows = byChat.get(key);
  if (!rows) return;
  const inQueue = new Set(queue.map((ref) => ref.messageId));
  for (const [id, row] of rows) {
    if (inQueue.has(id)) row.seen = true;
    else if (row.seen) rows.delete(id);
  }
  if (!rows.size) byChat.delete(key);
}

export function heldTimestamp(chatId: string, messageId: string): string | undefined {
  return byChat.get(chatKey(chatId))?.get(messageId)?.timestamp;
}

export function forgetSent(chatId: string): void {
  byChat.delete(chatKey(chatId));
}
