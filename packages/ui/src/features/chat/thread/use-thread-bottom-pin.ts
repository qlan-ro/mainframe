import { useCallback, useEffect, useLayoutEffect, useRef, type RefCallback } from 'react';

function createPinState() {
  return {
    pinned: true,
    locks: 0,
    frame: null as number | null,
    observer: null as ResizeObserver | null,
    removeScroll: null as (() => void) | null,
  };
}
function usePinObservers(
  viewportElement: React.RefObject<HTMLDivElement | null>,
  state: React.RefObject<ReturnType<typeof createPinState>>,
) {
  const viewportRef: RefCallback<HTMLDivElement> = useCallback(
    (element) => {
      state.current.removeScroll?.();
      viewportElement.current = element;
      if (!element) return;
      const track = () => {
        if (!state.current.locks)
          state.current.pinned = element.scrollHeight - element.clientHeight - element.scrollTop <= 2;
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
        if (state.current.frame !== null || state.current.locks) return;
        state.current.frame = requestAnimationFrame(() => {
          state.current.frame = null;
          const viewport = viewportElement.current;
          if (viewport && state.current.pinned && !state.current.locks) viewport.scrollTop = viewport.scrollHeight;
        });
      });
      state.current.observer.observe(element);
    },
    [state, viewportElement],
  );
  return { viewportRef, contentRef };
}

export function useThreadBottomPin(threadId: string | null) {
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const state = useRef(createPinState());
  const refs = usePinObservers(viewportElement, state);
  const beginInteraction = useCallback(() => {
    state.current.locks++;
    if (state.current.frame !== null) cancelAnimationFrame(state.current.frame);
    state.current.frame = null;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        state.current.locks--;
      }
    };
  }, []);
  useLayoutEffect(() => {
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
  return { ...refs, viewportElement, beginInteraction };
}
