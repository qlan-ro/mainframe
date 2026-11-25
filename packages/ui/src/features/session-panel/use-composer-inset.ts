import { useEffect, useState } from 'react';

/** Air between the floating panel and the composer. */
const COMPOSER_GAP = 8;

/**
 * How far above its chat column's bottom edge the floating panel must end to
 * clear the composer. Read off the column's own footer, which grows with the
 * draft, queue and pending gate.
 */
export function useComposerInset(element: HTMLElement | null): number {
  const [inset, setInset] = useState(COMPOSER_GAP);
  useEffect(() => {
    const column = element?.closest<HTMLElement>('[data-chat-column]');
    const footer = column?.querySelector<HTMLElement>('[data-chat-footer]');
    if (!column || !footer) return;
    const measure = () => {
      const box = column.getBoundingClientRect();
      // Rects are in zoomed pixels under a UI scale; the style below is not.
      const scale = column.offsetHeight ? box.height / column.offsetHeight : 1;
      setInset(Math.round((box.bottom - footer.getBoundingClientRect().top) / scale) + COMPOSER_GAP);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [element]);
  return inset;
}
