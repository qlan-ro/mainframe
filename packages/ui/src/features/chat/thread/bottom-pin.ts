/**
 * The transcript's bottom pin, as plain state and functions over the viewport
 * element. `use-thread-bottom-pin.ts` wires them to React; nothing else writes
 * the "following new output" position.
 */
import { SCROLLBAR_DRAG_EVENT } from '@/lib/overlay-scrollbars/thumb';
import { captureReadingAnchor, type ReadingAnchor } from './reading-anchor';

/** WebKit reports fractional offsets, so "at the bottom" allows a couple of pixels. */
export const AT_BOTTOM_PX = 2;

/**
 * The one definition of "at the bottom" for the transcript. The pin follows from
 * it, and the scroll-to-bottom button shows whenever the pin it drives is off.
 */
export function isAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= AT_BOTTOM_PX;
}

export function createPinState() {
  return {
    pinned: true,
    /** The transcript is opening: follow growth before paint until it settles (`followResize`). */
    opening: true,
    quietFrames: 0,
    openingFrame: null as number | null,
    /** The `pinned` value subscribers last heard. */
    published: true,
    listeners: new Set<() => void>(),
    /** An explicit re-pin arrived while an interaction held the lock. */
    repinOnRelease: false,
    anchor: null as ReadingAnchor | null,
    bottom: Infinity,
    top: Infinity,
    locks: 0,
    generation: 0,
    userScrollUntil: 0,
    dragging: false,
    frame: null as number | null,
    observer: null as ResizeObserver | null,
    footer: null as HTMLDivElement | null,
    removeScroll: null as (() => void) | null,
  };
}
export type PinState = ReturnType<typeof createPinState>;

/** Tells subscribers (the scroll-to-bottom button) when `pinned` flips. */
export function publishPinned(state: PinState) {
  if (state.published === state.pinned) return;
  state.published = state.pinned;
  state.listeners.forEach((listener) => listener());
}

/** Runs during render on a session switch, so it changes state without notifying. */
export function resetPin(state: PinState) {
  state.pinned = true;
  state.opening = true;
  state.repinOnRelease = false;
  state.anchor = null;
  state.bottom = Infinity;
  state.top = Infinity;
  state.locks = 0;
  state.generation++;
  state.userScrollUntil = 0;
}

function cancelFollow(state: PinState) {
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  state.frame = null;
}

export function scheduleFollow(viewportElement: React.RefObject<HTMLDivElement | null>, state: PinState) {
  if (state.frame !== null || state.locks || !state.pinned) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = null;
    const viewport = viewportElement.current;
    if (viewport && state.pinned && !state.locks) viewport.scrollTop = viewport.scrollHeight;
  });
}

/** Whole frames without a resize after which an opening transcript counts as settled. */
const OPENING_QUIET_FRAMES = 2;

/** Ends the opening phase once the list stops resizing (see `followResize`). */
function watchOpeningSettle(state: PinState) {
  state.quietFrames = 0;
  if (state.openingFrame !== null) return;
  const tick = () => {
    state.openingFrame = null;
    if (!state.opening) return;
    state.quietFrames++;
    if (state.quietFrames > OPENING_QUIET_FRAMES) state.opening = false;
    else state.openingFrame = requestAnimationFrame(tick);
  };
  state.openingFrame = requestAnimationFrame(tick);
}

/**
 * The content resized. While the transcript opens (a fresh mount or a session
 * switch), the pin jumps to the tail right here, inside the resize callback,
 * so each frame paints at the tail while the virtualized list measures its
 * rows. The opening ends at the reader's first scroll input, a lock, an unpin,
 * or once the list stops resizing; from then on, following waits for the next
 * frame. Ending early only costs that one frame, never a jump.
 */
export function followResize(viewportElement: React.RefObject<HTMLDivElement | null>, state: PinState) {
  const viewport = viewportElement.current;
  if (!state.opening || !viewport || !state.pinned || state.locks) {
    scheduleFollow(viewportElement, state);
    return;
  }
  cancelFollow(state);
  viewport.scrollTop = viewport.scrollHeight;
  state.bottom = viewport.scrollHeight - viewport.clientHeight;
  state.top = viewport.scrollTop;
  watchOpeningSettle(state);
}

export function trackPosition(element: HTMLDivElement, state: PinState, followGrowth = true) {
  if (element.clientHeight === 0) return;
  const bottom = element.scrollHeight - element.clientHeight;
  // Content can grow before the final scroll-to-bottom event arrives.
  state.pinned =
    isAtBottom(element) ||
    (followGrowth && state.pinned && element.scrollTop === state.top) ||
    (followGrowth && bottom > state.bottom && element.scrollTop >= state.bottom - AT_BOTTOM_PX);
  state.bottom = bottom;
  state.top = element.scrollTop;
  if (state.pinned) state.anchor = null;
  publishPinned(state);
}

export function trackReadingPosition(element: HTMLDivElement, state: PinState, followGrowth = true) {
  trackPosition(element, state, followGrowth);
  if (element.clientHeight && !state.pinned) state.anchor = captureReadingAnchor(element, state.anchor);
}

/**
 * Pins to the bottom and jumps there: the End key, the scroll-to-bottom button
 * and the user's own send. While an interaction holds the lock, the jump waits
 * for its release: the holder (a fold keeping its row, a prepend restoring its
 * anchor) still writes the offset, so jumping now would be undone, then redone.
 * The user's own send also cancels a prepend in flight (`use-prepend-anchor.ts`),
 * so it does not wait for the page to settle.
 */
export function pinToBottom(element: HTMLDivElement | null, state: PinState) {
  cancelFollow(state);
  state.pinned = true;
  state.anchor = null;
  state.userScrollUntil = 0;
  if (state.locks) state.repinOnRelease = true;
  else if (element) {
    element.scrollTop = element.scrollHeight;
    state.bottom = element.scrollHeight - element.clientHeight;
    state.top = element.scrollTop;
  }
  publishPinned(state);
}

/** The last lock's release: re-track the position, or finish a re-pin asked for meanwhile. */
function settleAfterInteraction(element: HTMLDivElement, state: PinState) {
  if (!state.repinOnRelease) {
    trackReadingPosition(element, state, false);
    return;
  }
  state.repinOnRelease = false;
  pinToBottom(element, state);
}

/**
 * Holds off following and position tracking while a fold, prepend or jump
 * moves the offset itself. The returned release is idempotent and is a no-op
 * once a session switch has reset the pin.
 */
export function beginLock(viewportElement: React.RefObject<HTMLDivElement | null>, state: PinState) {
  state.anchor = null;
  state.opening = false;
  state.locks++;
  const generation = state.generation;
  cancelFollow(state);
  let released = false;
  return () => {
    if (released || generation !== state.generation) return;
    released = true;
    state.locks--;
    const viewport = viewportElement.current;
    if (viewport && !state.locks) settleAfterInteraction(viewport, state);
  };
}

function scrollToBoundary(element: HTMLDivElement, state: PinState, event: KeyboardEvent) {
  if (event.defaultPrevented || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  if (event.key === 'End') {
    pinToBottom(element, state);
    return;
  }
  cancelFollow(state);
  state.pinned = false;
  state.anchor = null;
  element.scrollTop = 0;
  publishPinned(state);
}

/** Marks wheel, touch, scroll-key and scrollbar-drag input so their scroll events may unpin. */
export function trackUserScroll(element: HTMLDivElement, state: PinState) {
  const mark = (event: Event) => {
    if (event.type === 'keydown' && (event.target as Element).closest('input, textarea, [contenteditable="true"]'))
      return;
    state.userScrollUntil = performance.now() + 300;
    state.opening = false;
    if (event instanceof KeyboardEvent) scrollToBoundary(element, state, event);
  };
  const startDrag = () => {
    state.dragging = true;
  };
  const endDrag = () => {
    state.dragging = false;
  };
  element.addEventListener('wheel', mark, { passive: true });
  element.addEventListener('touchmove', mark, { passive: true });
  element.addEventListener('keydown', mark);
  element.addEventListener(SCROLLBAR_DRAG_EVENT, startDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  return () => {
    element.removeEventListener('wheel', mark);
    element.removeEventListener('touchmove', mark);
    element.removeEventListener('keydown', mark);
    element.removeEventListener(SCROLLBAR_DRAG_EVENT, startDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };
}

export function trackScroll(
  element: HTMLDivElement,
  viewportElement: React.RefObject<HTMLDivElement | null>,
  state: PinState,
) {
  const bottom = element.scrollHeight - element.clientHeight;
  const userScrolling = state.dragging || performance.now() < state.userScrollUntil;
  if (state.pinned && !userScrolling && element.clientHeight && bottom !== state.bottom) {
    // Layout moved the offset, not the reader: WebKit can deliver a shrink's
    // clamp after the content has grown again, which reads as scrolling up.
    state.bottom = bottom;
    state.top = element.scrollTop;
    if (!isAtBottom(element)) scheduleFollow(viewportElement, state);
    return;
  }
  trackReadingPosition(element, state);
}
