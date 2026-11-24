/**
 * Queued messages a Stop took back from the agent (C10): they were not sent,
 * so they stay in the composer until the user sends, edits or removes them.
 *
 * Persisted: the daemon no longer has them, so a reload must not lose them.
 * What a temporary session holds is never written down, and a chat's rows go
 * when the chat does (`clearChat`). Every change starts from what is stored,
 * and a change in one window reaches the others, so two windows neither
 * overwrite each other nor send the same row.
 *
 * A row being sent stays, claimed by the window that sends it, until the daemon
 * has it: quitting in between loses nothing. A claim ends with its window, or
 * after `CLAIM_MS` when the window went without saying so. A row whose prompt had
 * gone out by then may have reached the agent, so it comes back `unconfirmed`.
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
  /** Being sent, by this window. `started` once its own prompt has gone out. */
  claim?: { by: string; at: number; started?: true };
  /** Its prompt went out and nothing came back: the agent may have it. */
  unconfirmed?: true;
}

/** Longer than a prompt waits for its answer (`REQUEST_DEADLINE_MS`). */
export const CLAIM_MS = 45_000;
const WINDOW_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type Rows = readonly HeldMessage[];

interface HeldQueueState {
  byChat: Readonly<Record<string, Rows>>;
  hold: (chatId: string, ref: QueuedMessageRef, options?: { temporary?: boolean }) => void;
  /** False when there is no such row, or it is being sent. */
  edit: (chatId: string, messageId: string, content: string) => boolean;
  remove: (chatId: string, messageId: string) => void;
  /** Claims a row and everything behind it for this window; nothing while a send is under way. */
  claimFrom: (chatId: string, messageId: string) => Rows;
  /** Right before a claimed row's prompt goes out. False when it is not this window's to send any more. */
  startSending: (chatId: string, messageId: string) => boolean;
  /** Gives this window's claims back, in one chat or all of them. */
  releaseClaims: (chatId?: string) => void;
  clearChat: (chatId: string) => void;
}

const byTime = (a: HeldMessage, b: HeldMessage): number => a.timestamp.localeCompare(b.timestamp);

function merged(rows: Rows, added: Rows): Rows {
  const ids = new Set(added.map((row) => row.messageId));
  return [...rows.filter((row) => !ids.has(row.messageId)), ...added].sort(byTime);
}

/** The row as it stands now: a claim that outlived its window is none. */
export function settled(row: HeldMessage, now: number): HeldMessage {
  return row.claim && now - row.claim.at >= CLAIM_MS ? released(row) : row;
}

function released({ claim, ...row }: HeldMessage): HeldMessage {
  return claim?.started ? { ...row, unconfirmed: true } : row;
}

const mine = (row: HeldMessage): boolean => row.claim?.by === WINDOW_ID;

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
        const now = Date.now();
        const rows = change((get().byChat[chatId] ?? []).map((row) => settled(row, now)));
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
        edit: (chatId, messageId, content) => {
          let edited = false;
          update(chatId, (rows) =>
            rows.map((row) => {
              if (row.messageId !== messageId || row.claim) return row;
              edited = true;
              return { ...row, content };
            }),
          );
          return edited;
        },
        remove: (chatId, messageId) => update(chatId, (rows) => rows.filter((row) => row.messageId !== messageId)),
        claimFrom: (chatId, messageId) => {
          let claimed: Rows = [];
          update(chatId, (rows) => {
            const from = rows.findIndex((row) => row.messageId === messageId);
            if (from < 0 || rows.some((row) => row.claim)) return rows;
            const claim = { by: WINDOW_ID, at: Date.now() };
            claimed = rows.slice(from).map((row) => ({ ...row, claim }));
            return [...rows.slice(0, from), ...claimed];
          });
          return claimed;
        },
        startSending: (chatId, messageId) => {
          let started = false;
          update(chatId, (rows) => {
            if (!rows.some((row) => row.messageId === messageId && mine(row))) return rows;
            started = true;
            const claim = { by: WINDOW_ID, at: Date.now() };
            // The rows still to come stay claimed for as long as this one takes.
            return rows.map((row) => {
              if (!mine(row)) return row;
              return row.messageId === messageId ? { ...row, claim: { ...claim, started: true } } : { ...row, claim };
            });
          });
          return started;
        },
        releaseClaims: (only) => {
          for (const chatId of only === undefined ? Object.keys(get().byChat) : [only]) {
            if (!get().byChat[chatId]?.some(mine)) continue;
            update(chatId, (rows) => rows.map((row) => (mine(row) ? released(row) : row)));
          }
        },
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
  // Quitting, closing or reloading ends what this window was sending.
  window.addEventListener('pagehide', () => useHeldQueue.getState().releaseClaims());
}
