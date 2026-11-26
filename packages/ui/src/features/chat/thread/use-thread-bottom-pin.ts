/**
 * The transcript's follow mechanism: while the reader is at the bottom, growth
 * keeps them there; scrolling up releases it; the End key, the scroll-to-bottom
 * button and the user's own send re-pin. assistant-ui's viewport scroll
 * controllers are switched off in `ChatThreadViewport.tsx`, so this is the only
 * writer that follows new output.
 */
import { restoreReadingAnchor } from './reading-anchor';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefCallback } from 'react';
import {
  beginLock,
  createPinState,
  pinToBottom,
  publishPinned,
  resetPin,
  scheduleFollow,
  trackPosition,
  trackScroll,
  trackUserScroll,
  type PinState,
} from './bottom-pin';

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

function useInteractionLock(viewportElement: React.RefObject<HTMLDivElement | null>, state: React.RefObject<PinState>) {
  const isFollowing = useCallback(() => state.current.pinned && state.current.locks === 0, [state]);
  const isInteracting = useCallback(() => state.current.locks > 0, [state]);
  const beginInteraction = useCallback(() => beginLock(viewportElement, state.current), [state, viewportElement]);
  return { isFollowing, isInteracting, beginInteraction };
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
  const lock = useInteractionLock(viewportElement, state);
  // `isPinned` + `subscribePinned`: a `useSyncExternalStore` source for the scroll-to-bottom button.
  const isPinned = useCallback(() => state.current.pinned, []);
  const subscribePinned = useCallback((listener: () => void) => {
    const { listeners } = state.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const repin = useCallback(() => pinToBottom(viewportElement.current, state.current), []);
  useLayoutEffect(() => {
    const viewport = viewportElement.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    publishPinned(state.current);
  }, [threadId]);
  useEffect(() => {
    const current = state.current;
    return () => {
      current.removeScroll?.();
      current.observer?.disconnect();
      if (current.frame !== null) cancelAnimationFrame(current.frame);
    };
  }, []);
  return { ...refs, ...lock, isPinned, subscribePinned, footerRef, viewportElement, viewport, pinToBottom: repin };
}
