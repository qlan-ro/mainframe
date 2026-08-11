import { useCallback, useEffect, useRef, type RefCallback } from 'react';

const BOTTOM_THRESHOLD_PX = 2;

function isAtBottom(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_THRESHOLD_PX;
}

export function useThreadBottomPin() {
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const removeScrollListener = useRef<(() => void) | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const frame = useRef<number | null>(null);

  const viewportRef: RefCallback<HTMLDivElement> = useCallback((element) => {
    removeScrollListener.current?.();
    viewportElement.current = element;
    if (!element) return;

    const trackPinnedState = () => {
      pinned.current = isAtBottom(element);
    };
    trackPinnedState();
    element.addEventListener('scroll', trackPinnedState, { passive: true });
    removeScrollListener.current = () => element.removeEventListener('scroll', trackPinnedState);
  }, []);

  const contentRef: RefCallback<HTMLDivElement> = useCallback((element) => {
    resizeObserver.current?.disconnect();
    resizeObserver.current = null;
    if (!element || typeof ResizeObserver === 'undefined') return;

    resizeObserver.current = new ResizeObserver(() => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const viewport = viewportElement.current;
        if (viewport && pinned.current) viewport.scrollTop = viewport.scrollHeight;
      });
    });
    resizeObserver.current.observe(element);
  }, []);

  useEffect(
    () => () => {
      removeScrollListener.current?.();
      resizeObserver.current?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { viewportRef, contentRef };
}
