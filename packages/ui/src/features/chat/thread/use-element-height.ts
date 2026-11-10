import { useLayoutEffect, useState } from 'react';

/**
 * Border-box height (px) of an element, kept current through a ResizeObserver.
 * 0 while the element is null or when ResizeObserver is unavailable (jsdom).
 */
export function useElementHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!element) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element, { box: 'border-box' });
    return () => observer.disconnect();
  }, [element]);
  return height;
}
