/**
 * Which pages of one sub-agent's history are held (#450). The daemon cuts a finished sub-agent's
 * transcript into pages statelessly, so a page is named by its first item (its floor) and fetched
 * again exactly with `before` = the next page's floor and `untilItemId` = its own. The window holds
 * at most `SUBAGENT_PAGES_KEPT` pages: an older page drops the newest one, a newer page drops the
 * oldest one, and either comes back when the reader scrolls to it again.
 */
export const SUBAGENT_PAGES_KEPT = 3;

export interface PageWindow {
  /** The floor of every page seen so far, oldest first. Page `i` runs up to `floors[i + 1]`, the last to the end. */
  readonly floors: readonly string[];
  /** The oldest held page. */
  readonly top: number;
  /** The newest held page; `-1` when the transcript is empty. */
  readonly bottom: number;
  /** `floors[0]` is the transcript's first page. */
  readonly start: boolean;
}

export interface PageCursor {
  before?: string;
  until?: string;
}

/** A window of one page: the newest, or the first a reset brings back. */
export function firstWindow(floor: string | undefined, hasMore: boolean): PageWindow {
  return floor
    ? { floors: [floor], top: 0, bottom: 0, start: !hasMore }
    : { floors: [], top: 0, bottom: -1, start: true };
}

/** More is held above the window: the floor to page before, or nothing. */
export function olderCursor(window: PageWindow): PageCursor | null {
  const { floors, top } = window;
  if (top > 0) return { before: floors[top], until: floors[top - 1] };
  return !window.start && floors.length ? { before: floors[0] } : null;
}

/** Pages below the window were dropped: the request that brings the next one back. */
export function newerCursor(window: PageWindow): PageCursor | null {
  const { floors, bottom } = window;
  const next = bottom + 1;
  if (bottom < 0 || next >= floors.length) return null;
  // The newest page is the one the daemon cuts from the end, as on open.
  return next === floors.length - 1 ? {} : { before: floors[next + 1], until: floors[next] };
}

export const hasNewer = (window: PageWindow): boolean => newerCursor(window) !== null;

export interface Landed {
  window: PageWindow;
  /** Drop this item and everything after it (pages below the window). */
  dropFrom?: string;
  /** Drop everything before this item (pages above the window). */
  dropBefore?: string;
}

/**
 * An older page landed with floor `floor`. A page the window already knew keeps the floors above it;
 * any other (a first visit, or a page cut at a Find target) starts the list again from it.
 */
export function landOlder(window: PageWindow, floor: string, hasMore: boolean): Landed {
  const { top, bottom } = window;
  const known = top > 0 && window.floors[top - 1] === floor;
  const next: PageWindow = known
    ? { ...window, top: top - 1, start: top - 1 === 0 ? !hasMore : window.start }
    : { floors: [floor, ...window.floors.slice(top)], top: 0, bottom: bottom - top + 1, start: !hasMore };
  if (next.bottom - next.top + 1 <= SUBAGENT_PAGES_KEPT) return { window: next };
  const last = next.top + SUBAGENT_PAGES_KEPT - 1;
  return { window: { ...next, bottom: last }, dropFrom: next.floors[last + 1] };
}

/** A newer page landed. Null when it is not the page the window expected: the transcript changed. */
export function landNewer(window: PageWindow, floor: string | undefined): Landed | null {
  const next = window.bottom + 1;
  if (!floor || window.floors[next] !== floor) return null;
  const top = Math.max(window.top, next - SUBAGENT_PAGES_KEPT + 1);
  const landed: Landed = { window: { ...window, top, bottom: next } };
  return top > window.top ? { ...landed, dropBefore: window.floors[top] } : landed;
}
