/**
 * What a draft carries besides files, quotes and text (C14): preview captures
 * and code annotations, with their notes.
 *
 * Keyed and kept like the segments (`segment-store.ts`): in memory, by the aui
 * thread item id, cleared on send and when a draft slot is reused for another
 * new session. Choosing another project for the same draft keeps it.
 */
import { create } from 'zustand';
import { targetKey, type DraftProvenance, type DraftTarget } from './draft-target';

interface ItemBase extends DraftProvenance {
  id: string;
  note: string;
}

export interface DraftCapture extends ItemBase {
  kind: 'capture';
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
  /** The size of the region the user dragged, in page pixels. */
  region?: { w: number; h: number };
}

export interface DraftCodeNote extends ItemBase {
  kind: 'code';
  filePath: string;
  startLine: number;
  endLine: number;
  lineContent: string;
}

export interface DraftMention extends ItemBase {
  kind: 'mention';
  token: string;
  label: string;
  path: string;
  referenceLabel?: string;
  removed?: boolean;
}

export type DraftItem = DraftCapture | DraftCodeNote | DraftMention;
export type NewDraftItem = Omit<DraftCapture, 'id'> | Omit<DraftCodeNote, 'id'> | Omit<DraftMention, 'id'>;

interface DraftContentState {
  byThread: Readonly<Record<string, readonly DraftItem[]>>;
  add: (threadId: string, items: readonly NewDraftItem[]) => void;
  /** Puts back items a failed send had taken. */
  restore: (threadId: string, items: readonly DraftItem[]) => void;
  include: (threadId: string, itemIds: readonly string[], target: DraftTarget) => void;
  bindLegacy: (threadId: string, target: DraftTarget, references: ReadonlyMap<string, string>) => void;
  removeBinding: (threadId: string, itemId: string) => void;
  setNote: (threadId: string, itemId: string, note: string) => void;
  remove: (threadId: string, itemId: string) => void;
  clear: (threadId: string) => void;
}

const NO_ITEMS: readonly DraftItem[] = [];

export const useDraftContent = create<DraftContentState>((set) => {
  const update = (threadId: string, change: (items: readonly DraftItem[]) => readonly DraftItem[]) =>
    set((s) => {
      const current = s.byThread[threadId] ?? NO_ITEMS;
      const next = change(current);
      return next === current ? s : { byThread: { ...s.byThread, [threadId]: next } };
    });

  return {
    byThread: {},
    add: (threadId, items) =>
      update(threadId, (current) => [...current, ...items.map((item) => ({ ...item, id: crypto.randomUUID() }))]),
    restore: (threadId, items) =>
      update(threadId, (current) => {
        const currentById = new Map(current.map((item) => [item.id, item]));
        const restoredIds = new Set(items.map(({ id }) => id));
        return [
          ...items.map((item) => currentById.get(item.id) ?? item),
          ...current.filter(({ id }) => !restoredIds.has(id)),
        ];
      }),
    include: (threadId, itemIds, target) =>
      update(threadId, (current) =>
        current.map((item) =>
          itemIds.includes(item.id)
            ? { ...item, includedFor: [...new Set([...(item.includedFor ?? []), targetKey(target)])] }
            : item,
        ),
      ),
    bindLegacy: (threadId, origin, references) =>
      update(threadId, (current) => {
        const legacy: DraftMention[] = [];
        for (const [label, path] of references) {
          if (current.some((item) => item.kind === 'mention' && item.referenceLabel === label)) continue;
          legacy.push({
            id: crypto.randomUUID(),
            kind: 'mention',
            token: `@${label}`,
            label,
            path,
            referenceLabel: label,
            note: '',
            origin,
          });
        }
        if (legacy.length === 0 && current.every((item) => item.origin)) return current;
        return [...current.map((item) => (item.origin ? item : { ...item, origin })), ...legacy];
      }),
    removeBinding: (threadId, itemId) =>
      update(threadId, (current) =>
        current.map((item) => (item.kind === 'mention' && item.id === itemId ? { ...item, removed: true } : item)),
      ),
    setNote: (threadId, itemId, note) =>
      update(threadId, (current) => current.map((item) => (item.id === itemId ? { ...item, note } : item))),
    remove: (threadId, itemId) => update(threadId, (current) => current.filter((item) => item.id !== itemId)),
    clear: (threadId) => update(threadId, (current) => (current.length === 0 ? current : NO_ITEMS)),
  };
});

export function draftItemsOf(threadId: string): readonly DraftItem[] {
  return useDraftContent.getState().byThread[threadId] ?? NO_ITEMS;
}

export function useDraftItems(threadId: string | undefined): readonly DraftItem[] {
  return useDraftContent((s) => (threadId ? (s.byThread[threadId] ?? NO_ITEMS) : NO_ITEMS));
}

// ── Captures a send has taken ────────────────────────────────────────────────

/**
 * A capture leaves as an image attachment, which has nowhere to keep its note
 * and selector. Until the send settles the capture is kept here by attachment
 * id, so a failed one returns to its draft as the tile it was.
 */
const inFlight = new Map<string, { threadId: string; capture: DraftCapture }>();

export function holdSentCaptures(threadId: string, captures: readonly DraftCapture[]): void {
  for (const capture of captures) inFlight.set(capture.id, { threadId, capture });
}

export function forgetSentCaptures(attachmentIds: readonly string[]): void {
  for (const id of attachmentIds) inFlight.delete(id);
}

/** True when the attachment was a capture and is back in its draft. */
export function restoreSentCapture(attachmentId: string): boolean {
  const held = inFlight.get(attachmentId);
  if (!held) return false;
  useDraftContent.getState().restore(held.threadId, [held.capture]);
  return true;
}
