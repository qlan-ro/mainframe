import { useEffect, useState } from 'react';

/** The two edges' header depths, in px. */
export interface StickyInsets {
  top: number;
  bottom: number;
}

/** Only the vertical bounds of the scroller matter to the measurement. */
interface Edges {
  top: number;
  bottom: number;
}

const EMPTY: StickyInsets = { top: 0, bottom: 0 };

/** Sub-pixel scroll positions never land exactly on the bounds. */
const EPSILON = 1;

/** Anything sticky at an edge is a header; nothing else in this scroller sticks. */
const HEADER_SELECTOR = '[data-slot="sidebar-group-label"]';

/** Headers stack (parked header, then whichever group you're in), so depth isn't one header's height — read it from layout instead. */
export function stickyInset(bounds: Edges, headers: readonly Edges[], edge: 'top' | 'bottom'): number {
  let inset = 0;

  for (const rect of headers) {
    const depth = edge === 'top' ? rect.bottom - bounds.top : bounds.bottom - rect.top;
    const offset = edge === 'top' ? rect.top - bounds.top : bounds.bottom - rect.bottom;
    // Parked against this edge, or stacked directly behind one that is.
    if (offset <= inset + EPSILON && depth > inset) inset = depth;
  }

  return inset;
}

/** Depth of the sticky headers at each edge, re-measured on scroll and on resize — the list is windowed, so content height changes without a scroll event. */
export function useStickyInsets(viewport: HTMLElement | null): StickyInsets {
  const [insets, setInsets] = useState<StickyInsets>(EMPTY);

  useEffect(() => {
    if (viewport == null) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const bounds = viewport.getBoundingClientRect();
      const headers = Array.from(viewport.querySelectorAll(HEADER_SELECTOR), (header) =>
        header.getBoundingClientRect(),
      );
      const next: StickyInsets = {
        top: stickyInset(bounds, headers, 'top'),
        bottom: stickyInset(bounds, headers, 'bottom'),
      };
      setInsets((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };

    // Coalesced: scroll fires far more often than the header stack can change.
    const update = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    viewport.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild != null) observer.observe(viewport.firstElementChild);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [viewport]);

  return insets;
}
