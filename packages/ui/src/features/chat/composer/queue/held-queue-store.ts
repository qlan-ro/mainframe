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
 * A row being sent stays, claimed by the press that sends it, until the daemon
 * has it: quitting in between loses nothing. A press sends only what it still
 * holds, so one that was stopped, or whose claim ran out, sends nothing when it
 * wakes up, and gives back nothing of a later one's. A claim ends with its window, or
 * after `CLAIM_MS` when the window went without saying so. A row whose prompt had
 * gone out by then may have reached the agent, so it comes back `unconfirmed`,
 * unless it was refused (`refuse`): then it keeps the reason.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { forgetSent } from './sent-order';

const STORAGE_KEY = 'mf:held-queue';

export interface HeldMessage {
  messageId: string;
  content: string;
  attachmentIds?: string[];
  timestamp: string;
  /** The daemon its chat lives on; the rows of every daemon are kept together. */
  daemon?: string;
  /** From a temporary session: kept in memory only. */
  unsaved?: true;
  /** Being sent: by which window, and which press of "Send now" there. `started` once its own prompt has gone out. */
  claim?: { by: string; press: string; at: number; started?: true };
  /** Why its last send was refused: it certainly did not reach the agent. */
  refused?: string;
  /** Its prompt went out and nothing came back: the agent may have it. */
  unconfirmed?: true;
}

/** Longer than a prompt waits for its answer (`REQUEST_DEADLINE_MS`). */
export const CLAIM_MS = 45_000;
const WINDOW_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type Rows = readonly HeldMessage[];

interface HeldQueueState {
  byChat: Readonly<Record<string, Rows>>;
  /** `timestamp`: where it stood before, when it was held and sent already. */
  hold: (chatId: string, ref: QueuedMessageRef, options?: { temporary?: boolean; timestamp?: string }) => void;
  /** False when there is no such row, or it is being sent. */
  edit: (chatId: string, messageId: string, content: string) => boolean;
  remove: (chatId: string, messageId: string) => void;
  /** Claims a row and everything behind it for one press; nothing while a send is under way. */
  claimFrom: (chatId: string, messageId: string, press: string) => Rows;
  /**
   * Right before a claimed row's prompt goes out. False when it is not this
   * press's to send any more, or has gone out already.
   */
  startSending: (chatId: string, messageId: string, press: string) => boolean;
  /** A send that certainly did not reach the agent: the row comes back with the reason. */
  refuse: (chatId: string, messageId: string, press: string, reason: string) => void;
  /** Gives back the claimed rows this window has not sent: a Stop, while "Send now" is under way. */
  releaseUnsent: (chatId: string) => void;
  /** Gives back what a press still has, and no other press's. */
  releasePress: (chatId: string, press: string) => void;
  /** Gives this window's claims back, in every chat. */
  releaseClaims: () => void;
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
const pressed = (row: HeldMessage, press: string): boolean => row.claim?.press === press;
const unsent = (row: HeldMessage): boolean => mine(row) && row.claim?.started !== true;

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
        hold: (chatId, ref, { temporary = false, timestamp = ref.timestamp } = {}) =>
          update(chatId, (rows) =>
            merged(rows, [
              {
                messageId: ref.messageId,
                content: ref.content,
                ...(ref.attachmentIds && { attachmentIds: ref.attachmentIds }),
                timestamp,
                daemon: getActiveDaemon().id,
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
        claimFrom: (chatId, messageId, press) => {
          let claimed: Rows = [];
          update(chatId, (rows) => {
            const from = rows.findIndex((row) => row.messageId === messageId);
            if (from < 0 || rows.some((row) => row.claim)) return rows;
            const claim = { by: WINDOW_ID, press, at: Date.now() };
            claimed = rows.slice(from).map((row) => ({ ...row, claim }));
            return [...rows.slice(0, from), ...claimed];
          });
          return claimed;
        },
        startSending: (chatId, messageId, press) => {
          let started = false;
          update(chatId, (rows) => {
            const row = rows.find((candidate) => candidate.messageId === messageId);
            if (!row || !pressed(row, press) || row.claim?.started) return rows;
            started = true;
            const claim = { by: WINDOW_ID, press, at: Date.now() };
            // The rows still to come stay claimed for as long as this one takes.
            return rows.map((other) => {
              if (!pressed(other, press)) return other;
              if (other.messageId !== messageId) return { ...other, claim };
              const { refused: _, ...rest } = other;
              return { ...rest, claim: { ...claim, started: true } };
            });
          });
          return started;
        },
        refuse: (chatId, messageId, press, reason) =>
          update(chatId, (rows) =>
            rows.map((row) => {
              // Another press has it by now: what it finds out is newer.
              if (row.messageId !== messageId || (row.claim && !pressed(row, press))) return row;
              const { claim: _, ...rest } = row;
              return { ...rest, refused: reason };
            }),
          ),
        releaseUnsent: (chatId) => {
          if (!get().byChat[chatId]?.some(unsent)) return;
          update(chatId, (rows) => rows.map((row) => (unsent(row) ? released(row) : row)));
        },
        releasePress: (chatId, press) => {
          if (!get().byChat[chatId]?.some((row) => pressed(row, press))) return;
          update(chatId, (rows) => rows.map((row) => (pressed(row, press) ? released(row) : row)));
        },
        releaseClaims: () => {
          for (const chatId of Object.keys(get().byChat)) {
            if (!get().byChat[chatId]?.some(mine)) continue;
            update(chatId, (rows) => rows.map((row) => (mine(row) ? released(row) : row)));
          }
        },
        clearChat: (chatId) => {
          forgetSent(chatId);
          update(chatId, () => []);
        },
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
