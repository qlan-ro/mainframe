import { captureReadingAnchor, restoreReadingAnchor, type ReadingAnchor } from './reading-anchor';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefCallback } from 'react';

function createPinState() {
  return {
    pinned: true,
    anchor: null as ReadingAnchor | null,
    bottom: Infinity,
    top: Infinity,
    locks: 0,
    frame: null as number | null,
    observer: null as ResizeObserver | null,
    footer: null as HTMLDivElement | null,
    removeScroll: null as (() => void) | null,
  };
}
function trackPosition(element: HTMLDivElement, state: ReturnType<typeof createPinState>, followGrowth = true) {
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

function trackReadingPosition(element: HTMLDivElement, state: ReturnType<typeof createPinState>, followGrowth = true) {
  trackPosition(element, state, followGrowth);
  if (element.clientHeight && !state.pinned) state.anchor = captureReadingAnchor(element, state.anchor);
}

function usePinObservers(
  viewportElement: React.RefObject<HTMLDivElement | null>,
  state: React.RefObject<ReturnType<typeof createPinState>>,
) {
  const viewportRef: RefCallback<HTMLDivElement> = useCallback(
    (element) => {
      state.current.removeScroll?.();
      if (viewportElement.current) state.current.observer?.unobserve(viewportElement.current);
      viewportElement.current = element;
      if (!element) return;
      state.current.observer?.observe(element);
      const track = () => {
        if (!state.current.locks) trackReadingPosition(element, state.current);
      };
      track();
      element.addEventListener('scroll', track, { passive: true });
      state.current.removeScroll = () => element.removeEventListener('scroll', track);
    },
    [state, viewportElement],
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
        if (state.current.frame !== null || state.current.locks || !state.current.pinned) return;
        state.current.frame = requestAnimationFrame(() => {
          state.current.frame = null;
          const viewport = viewportElement.current;
          if (viewport && state.current.pinned && !state.current.locks) viewport.scrollTop = viewport.scrollHeight;
        });
      });
      state.current.observer.observe(element);
      if (viewportElement.current) state.current.observer.observe(viewportElement.current);
      if (state.current.footer) state.current.observer.observe(state.current.footer);
    },
    [state, viewportElement],
  );
  return { viewportRef, contentRef };
}

function useFooterObserver(state: React.RefObject<ReturnType<typeof createPinState>>) {
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
  const state = useRef(createPinState());
  const refs = usePinObservers(viewportElement, state);
  const footerRef = useFooterObserver(state);
  const isFollowing = useCallback(() => state.current.pinned && state.current.locks === 0, []);
  const beginInteraction = useCallback(() => {
    state.current.anchor = null;
    state.current.locks++;
    if (state.current.frame !== null) cancelAnimationFrame(state.current.frame);
    state.current.frame = null;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        state.current.locks--;
        const viewport = viewportElement.current;
        if (viewport && !state.current.locks) trackReadingPosition(viewport, state.current, false);
      }
    };
  }, []);
  useLayoutEffect(() => {
    state.current.anchor = null;
    state.current.pinned = true;
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
  return { ...refs, footerRef, viewportElement, beginInteraction, isFollowing };
}
