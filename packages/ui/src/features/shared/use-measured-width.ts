import { useCallback, useRef, useState } from 'react';

/** Tracks an element's clientWidth; null until the returned callback ref attaches. */
export function useMeasuredWidth(): [number | null, (el: HTMLElement | null) => void] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (el == null) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    observerRef.current = observer;
  }, []);
  return [width, measure];
}
