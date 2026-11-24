/**
 * Queued messages a Stop took back from the agent (C10): they were not sent,
 * so they stay in the composer until the user sends, edits or removes them.
 *
 * Persisted: the daemon no longer has them, so a reload must not lose them.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

export interface HeldMessage {
  messageId: string;
  content: string;
  attachmentIds?: string[];
  timestamp: string;
}

interface HeldQueueState {
  byChat: Readonly<Record<string, readonly HeldMessage[]>>;
  hold: (chatId: string, ref: QueuedMessageRef) => void;
  edit: (chatId: string, messageId: string, content: string) => void;
  remove: (chatId: string, messageId: string) => void;
}

export const useHeldQueue = create<HeldQueueState>()(
  persist(
    (set) => {
      const update = (chatId: string, change: (rows: readonly HeldMessage[]) => readonly HeldMessage[]) =>
        set((s) => {
          const rows = change(s.byChat[chatId] ?? []);
          const { [chatId]: _, ...rest } = s.byChat;
          return { byChat: rows.length > 0 ? { ...rest, [chatId]: rows } : rest };
        });
      return {
        byChat: {},
        hold: (chatId, ref) =>
          update(chatId, (rows) =>
            [
              ...rows.filter((row) => row.messageId !== ref.messageId),
              {
                messageId: ref.messageId,
                content: ref.content,
                ...(ref.attachmentIds && { attachmentIds: ref.attachmentIds }),
                timestamp: ref.timestamp,
              },
            ].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
          ),
        edit: (chatId, messageId, content) =>
          update(chatId, (rows) => rows.map((row) => (row.messageId === messageId ? { ...row, content } : row))),
        remove: (chatId, messageId) => update(chatId, (rows) => rows.filter((row) => row.messageId !== messageId)),
      };
    },
    { name: 'mf:held-queue', version: 1 },
  ),
);
