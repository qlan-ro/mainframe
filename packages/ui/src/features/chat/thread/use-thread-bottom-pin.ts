import { captureReadingAnchor, restoreReadingAnchor, type ReadingAnchor } from './reading-anchor';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefCallback } from 'react';

function createPinState() {
  return {
    pinned: true,
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
type PinState = ReturnType<typeof createPinState>;

function resetPin(state: PinState) {
  state.pinned = true;
  state.anchor = null;
  state.bottom = Infinity;
  state.top = Infinity;
  state.locks = 0;
  state.generation++;
  state.userScrollUntil = 0;
}

function scheduleFollow(viewportElement: React.RefObject<HTMLDivElement | null>, state: PinState) {
  if (state.frame !== null || state.locks || !state.pinned) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = null;
    const viewport = viewportElement.current;
    if (viewport && state.pinned && !state.locks) viewport.scrollTop = viewport.scrollHeight;
  });
}

function trackPosition(element: HTMLDivElement, state: PinState, followGrowth = true) {
  if (element.clientHeight === 0) return;
  const bottom = element.scrollHeight - element.clientHeight;
  // Content can grow before the final scroll-to-bottom event arrives.
  state.pinned =
    bottom - element.scrollTop <= 2 ||
    (followGrowth && state.pinned && element.scrollTop === state.top) ||
    (followGrowth && bottom > state.bottom && element.scrollTop >= state.bottom - 2);
  state.bottom = bottom;
  state.top = element.scrollTop;
  if (state.pinned) state.anchor = null;
}

function trackReadingPosition(element: HTMLDivElement, state: PinState, followGrowth = true) {
  trackPosition(element, state, followGrowth);
  if (element.clientHeight && !state.pinned) state.anchor = captureReadingAnchor(element, state.anchor);
}

/** Marks wheel, touch, scroll-key and scrollbar-drag input so their scroll events may unpin. */
function trackUserScroll(element: HTMLDivElement, state: PinState) {
  const mark = (event: Event) => {
    if (event.type === 'keydown' && (event.target as Element).closest('input, textarea, [contenteditable="true"]'))
      return;
    state.userScrollUntil = performance.now() + 300;
  };
  // Only the scrollbar itself targets the viewport; content clicks target content.
  const startDrag = (event: PointerEvent) => {
    if (event.target === element) state.dragging = true;
  };
  const endDrag = () => {
    state.dragging = false;
  };
  element.addEventListener('wheel', mark, { passive: true });
  element.addEventListener('touchmove', mark, { passive: true });
  element.addEventListener('keydown', mark);
  element.addEventListener('pointerdown', startDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  return () => {
    element.removeEventListener('wheel', mark);
    element.removeEventListener('touchmove', mark);
    element.removeEventListener('keydown', mark);
    element.removeEventListener('pointerdown', startDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };
}

function trackScroll(
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
    if (bottom - element.scrollTop > 2) scheduleFollow(viewportElement, state);
    return;
  }
  trackReadingPosition(element, state);
}

function usePinObservers(
  viewportElement: React.RefObject<HTMLDivElement | null>,
  state: React.RefObject<PinState>,
  setViewport: (element: HTMLDivElement | null) => void,
) {
  const viewportRef: RefCallback<HTMLDivElement> = useCallback(
    (element) => {
      state.current.removeScroll?.();
      if (viewportElement.current) state.current.observer?.unobserve(viewportElement.current);
      viewportElement.current = element;
      setViewport(element);
      if (!element) return;
      state.current.observer?.observe(element);
      const track = () => {
        if (!state.current.locks) trackScroll(element, viewportElement, state.current);
      };
      const stopUserScrollTracking = trackUserScroll(element, state.current);
      track();
      element.addEventListener('scroll', track, { passive: true });
      state.current.removeScroll = () => {
        element.removeEventListener('scroll', track);
        stopUserScrollTracking();
      };
    },
    [state, viewportElement, setViewport],
  );
  const contentRef: RefCallback<HTMLDivElement> = useCallback(
    (element) => {
      state.current.observer?.disconnect();
      state.current.observer = null;
      if (!element || typeof ResizeObserver === 'undefined') return;
      state.current.observer = new ResizeObserver(() => {
        const viewport = viewportElement.current;
        if (!viewport || viewport.clientHeight === 0) return;
        if (!state.current.locks && !state.current.pinned) {
          state.current.anchor = restoreReadingAnchor(viewport, state.current.anchor);
          trackPosition(viewport, state.current);
        }
        scheduleFollow(viewportElement, state.current);
      });
      state.current.observer.observe(element);
      if (viewportElement.current) state.current.observer.observe(viewportElement.current);
      if (state.current.footer) state.current.observer.observe(state.current.footer);
    },
    [state, viewportElement],
  );
  return { viewportRef, contentRef };
}

function useFooterObserver(state: React.RefObject<PinState>) {
  return useCallback(
    (element: HTMLDivElement | null) => {
      if (state.current.footer) state.current.observer?.unobserve(state.current.footer);
      state.current.footer = element;
      if (element) state.current.observer?.observe(element);
    },
    [state],
  );
}

export function useThreadBottomPin(threadId: string | null) {
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const state = useRef(createPinState());
  const pinnedThread = useRef(threadId);
  if (pinnedThread.current !== threadId) {
    // Reset before children's layout effects: compact auto-folding asks
    // isFollowing() there, ahead of this hook's own layout effect.
    pinnedThread.current = threadId;
    resetPin(state.current);
  }
  const refs = usePinObservers(viewportElement, state, setViewport);
  const footerRef = useFooterObserver(state);
  const isFollowing = useCallback(() => state.current.pinned && state.current.locks === 0, []);
  const beginInteraction = useCallback(() => {
    state.current.anchor = null;
    state.current.locks++;
    const generation = state.current.generation;
    if (state.current.frame !== null) cancelAnimationFrame(state.current.frame);
    state.current.frame = null;
    let released = false;
    return () => {
      if (!released && generation === state.current.generation) {
        released = true;
        state.current.locks--;
        const viewport = viewportElement.current;
        if (viewport && !state.current.locks) trackReadingPosition(viewport, state.current, false);
      }
    };
  }, []);
  useLayoutEffect(() => {
    const viewport = viewportElement.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [threadId]);
  useEffect(() => {
    const current = state.current;
    return () => {
      current.removeScroll?.();
      current.observer?.disconnect();
      if (current.frame !== null) cancelAnimationFrame(current.frame);
    };
  }, []);
  return { ...refs, footerRef, viewportElement, viewport, beginInteraction, isFollowing };
}
