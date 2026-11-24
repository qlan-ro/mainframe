/**
 * Queued messages a Stop took back from the agent (C10): they were not sent,
 * so they stay in the composer until the user sends, edits or removes them.
 *
 * Persisted: the daemon no longer has them, so a reload must not lose them.
 * What a temporary session holds is never written down, and a chat's rows go
 * when the chat does (`clearChat`). Every change starts from what is stored,
 * and a change in one window reaches the others, so two windows neither
 * overwrite each other nor send the same row.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

const STORAGE_KEY = 'mf:held-queue';

export interface HeldMessage {
  messageId: string;
  content: string;
  attachmentIds?: string[];
  timestamp: string;
  /** From a temporary session: kept in memory only. */
  unsaved?: true;
}

type Rows = readonly HeldMessage[];

interface HeldQueueState {
  byChat: Readonly<Record<string, Rows>>;
  hold: (chatId: string, ref: QueuedMessageRef, options?: { temporary?: boolean }) => void;
  edit: (chatId: string, messageId: string, content: string) => void;
  remove: (chatId: string, messageId: string) => void;
  /** Takes a row and everything behind it out, so no one else can send them. */
  takeFrom: (chatId: string, messageId: string) => Rows;
  putBack: (chatId: string, rows: Rows) => void;
  clearChat: (chatId: string) => void;
}

const byTime = (a: HeldMessage, b: HeldMessage): number => a.timestamp.localeCompare(b.timestamp);

function merged(rows: Rows, added: Rows): Rows {
  const ids = new Set(added.map((row) => row.messageId));
  return [...rows.filter((row) => !ids.has(row.messageId)), ...added].sort(byTime);
}

/** What another window stored, plus this window's own unsaved rows. */
function withUnsaved(stored: Readonly<Record<string, Rows>>, current: Readonly<Record<string, Rows>>) {
  const next: Record<string, Rows> = { ...stored };
  for (const [chatId, rows] of Object.entries(current)) {
    const unsaved = rows.filter((row) => row.unsaved);
    if (unsaved.length > 0) next[chatId] = merged(next[chatId] ?? [], unsaved);
  }
  return next;
}

export const useHeldQueue = create<HeldQueueState>()(
  persist(
    (set, get) => {
      const update = (chatId: string, change: (rows: Rows) => Rows) => {
        // localStorage rehydrates synchronously: start from what is stored now.
        void useHeldQueue.persist?.rehydrate();
        const rows = change(get().byChat[chatId] ?? []);
        set((s) => {
          const { [chatId]: _, ...rest } = s.byChat;
          return { byChat: rows.length > 0 ? { ...rest, [chatId]: rows } : rest };
        });
      };
      return {
        byChat: {},
        hold: (chatId, ref, { temporary = false } = {}) =>
          update(chatId, (rows) =>
            merged(rows, [
              {
                messageId: ref.messageId,
                content: ref.content,
                ...(ref.attachmentIds && { attachmentIds: ref.attachmentIds }),
                timestamp: ref.timestamp,
                ...(temporary && { unsaved: true as const }),
              },
            ]),
          ),
        edit: (chatId, messageId, content) =>
          update(chatId, (rows) => rows.map((row) => (row.messageId === messageId ? { ...row, content } : row))),
        remove: (chatId, messageId) => update(chatId, (rows) => rows.filter((row) => row.messageId !== messageId)),
        takeFrom: (chatId, messageId) => {
          let taken: Rows = [];
          update(chatId, (rows) => {
            const at = rows.findIndex((row) => row.messageId === messageId);
            if (at < 0) return rows;
            taken = rows.slice(at);
            return rows.slice(0, at);
          });
          return taken;
        },
        putBack: (chatId, added) => update(chatId, (rows) => merged(rows, added)),
        clearChat: (chatId) => update(chatId, () => []),
      };
    },
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({
        byChat: Object.fromEntries(
          Object.entries(s.byChat)
            .map(([chatId, rows]) => [chatId, rows.filter((row) => !row.unsaved)] as const)
            .filter(([, rows]) => rows.length > 0),
        ),
      }),
      merge: (persisted, current) => ({
        ...current,
        byChat: withUnsaved((persisted as Partial<HeldQueueState> | undefined)?.byChat ?? {}, current.byChat),
      }),
    },
  ),
);

// Another window's change. `storage` never fires in the window that wrote.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) void useHeldQueue.persist?.rehydrate();
  });
}
