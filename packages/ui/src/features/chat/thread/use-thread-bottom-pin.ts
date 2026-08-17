import { useCallback, useEffect, useLayoutEffect, useRef, type RefCallback } from 'react';

const BOTTOM_THRESHOLD_PX = 2;

function isAtBottom(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_THRESHOLD_PX;
}

/**
 * Keeps the transcript pinned to its bottom edge.
 *
 * `threadId` is the session the viewport is currently showing. Every session in
 * the single-thread surface shares ONE viewport element, so a switch changes the
 * content underneath a scroll offset that survives — and assistant-ui's own
 * switch-scroll (`threadListItem.switchedTo` → scrollToBottom) never reaches a
 * Viewport mounted outside the per-item subtree, as ours is. Without the re-pin
 * below, switching into a session after reading back in any session left the
 * transcript parked mid-history.
 */
export function useThreadBottomPin(threadId: string | null) {
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

  // A switched-into session starts pinned regardless of where the previous one
  // was left; its history often lands a beat later, which the observer above
  // then follows down.
  useLayoutEffect(() => {
    pinned.current = true;
    const viewport = viewportElement.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [threadId]);

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
