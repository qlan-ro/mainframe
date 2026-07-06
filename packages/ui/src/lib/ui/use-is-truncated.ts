import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Tracks whether a single-line (`truncate`) element is actually clipped, i.e.
 * `scrollWidth > clientWidth`. Re-measures on element resize (ResizeObserver)
 * and whenever `dep` changes (e.g. the rendered text). Used to suppress
 * tooltips that would merely repeat fully-visible text — show them only when
 * the label is cut off and the tooltip reveals the rest.
 */
export function useIsTruncated(ref: RefObject<HTMLElement | null>, dep?: unknown): boolean {
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // +1 absorbs sub-pixel rounding so a perfectly-fitting label isn't flagged.
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, dep]);

  return truncated;
}
