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

/**
 * Depth of the sticky headers stacked against one edge of `bounds`.
 *
 * They stack — a parked section header, then the group header of whichever
 * group you are inside — so the stack's depth changes as you scroll and cannot
 * be assumed from one header's height. An edge ramp that has to start below
 * them therefore has to read them from layout, not hardcode a height.
 */
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

/**
 * Tracks how deep the sticky headers parked at each edge of a scroller run, so
 * its `scroll-fade` ramps can start below them instead of dissolving them.
 *
 * Content height is watched as well as scroll position — the list is windowed,
 * so it grows and shrinks without any scroll event firing.
 */
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
