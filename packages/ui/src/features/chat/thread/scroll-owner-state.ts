/** The scroll owner's record (`use-scroll-owner.ts`) and the small pieces that read or write it. */
import { AT_BOTTOM_PX } from './bottom-pin';

const BLOCKS = 'p, pre, table, li, h2, h3, img, [data-message-id], [data-history-item-id]';
/** How long the reader's downward input may take to bring the position to the bottom (a flick's momentum sends wheel events throughout). */
export const DOWN_INTENT_MS = 1000;

/** What the reader is looking at: the block a third of the way down the viewport. */
export function readerAnchor(viewport: HTMLElement) {
  const box = viewport.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + viewport.clientHeight / 3);
  const row = hit?.closest<HTMLElement>(BLOCKS);
  return row && viewport.contains(row) ? { row, offset: row.getBoundingClientRect().top - box.top } : null;
}

export interface Near {
  row: HTMLElement;
  /** The block's top in the content, which a page above it moves by exactly the page's height. */
  at: number;
  scrollTop: number;
}

export interface OwnerState {
  following: boolean;
  /** When the reader last gave downward input (0: not since they last moved up or followed). */
  downAt: number;
  lastTop: number;
  /** The layout the owner last acted on: a scroll that comes with another one is the browser's, not the reader's. */
  seenHeight: number;
  seenClient: number;
  published: boolean;
  listeners: Set<() => void>;
  restore: null | ReturnType<typeof readerAnchor>;
  near: Near | null;
  /** The frame that clears a record no resize used (a page that changed nothing's height). */
  staleFrame: number;
  away: boolean;
}

export function createOwnerState(following: boolean, away: boolean): OwnerState {
  return {
    following,
    downAt: 0,
    lastTop: 0,
    seenHeight: 0,
    seenClient: 0,
    published: following,
    listeners: new Set(),
    restore: null,
    near: null,
    staleFrame: 0,
    away,
  };
}

/** Records the position and the layout the owner has now acted on. */
export function seen(current: OwnerState, el: HTMLElement) {
  current.lastTop = el.scrollTop;
  current.seenHeight = el.scrollHeight;
  current.seenClient = el.clientHeight;
}

/**
 * A move up that a layout the owner has not acted on yet explains: the browser clamped the position against the
 * new viewport (it lands at the old content's bottom), or anchored it by no more than the sizes changed. A move
 * larger than that is someone scrolling (the reader's threaded scroll before its wheel event, a selection drag,
 * Find), even while a stream changes the layout every frame.
 */
export function layoutExplains(current: OwnerState, el: HTMLElement, top: number): boolean {
  const height = el.scrollHeight - current.seenHeight;
  const client = el.clientHeight - current.seenClient;
  if (height === 0 && client === 0) return false;
  const clamped = top >= current.seenHeight - el.clientHeight - AT_BOTTOM_PX;
  return clamped || current.lastTop - top <= Math.abs(height) + Math.abs(client) + 1;
}

/** The reader's downward input is recent enough to explain reaching the bottom. */
export const wantsDown = (current: OwnerState) =>
  current.downAt > 0 && performance.now() - current.downAt < DOWN_INTENT_MS;

/** A boolean others can read and subscribe to (`tailPending`). */
export function createFlag() {
  const listeners = new Set<() => void>();
  let value = false;
  return {
    get: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: boolean) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}
