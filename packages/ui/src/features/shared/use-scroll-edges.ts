import { useEffect, useState } from 'react';

export interface ScrollEdges {
  /** True when there is content scrolled off the top. */
  top: boolean;
  /** True when there is content still below the fold. */
  bottom: boolean;
  /** Height of the sticky headers currently parked at each edge, in px. */
  topInset: number;
  bottomInset: number;
}

const EMPTY: ScrollEdges = { top: false, bottom: false, topInset: 0, bottomInset: 0 };

/** Sub-pixel scroll positions never land exactly on the bounds. */
const EPSILON = 1;

/** Anything sticky at an edge is a header; nothing else in this scroller sticks. */
const HEADER_SELECTOR = '[data-slot="sidebar-group-label"]';

/**
 * Measures the sticky headers stacked against one edge.
 *
 * They stack — a parked section header, then the group header of whichever
 * group you are inside — so the stack's depth changes as you scroll and cannot
 * be assumed from one header's height. Anything an edge fade has to start below
 * therefore has to be read from layout, not hardcoded.
 */
function insetAt(viewport: HTMLElement, edge: 'top' | 'bottom'): number {
  const bounds = viewport.getBoundingClientRect();
  let inset = 0;

  for (const header of viewport.querySelectorAll(HEADER_SELECTOR)) {
    const rect = header.getBoundingClientRect();
    const depth = edge === 'top' ? rect.bottom - bounds.top : bounds.bottom - rect.top;
    const offset = edge === 'top' ? rect.top - bounds.top : bounds.bottom - rect.bottom;
    // Parked against this edge, or stacked directly behind one that is.
    if (offset <= inset + EPSILON && depth > inset) inset = depth;
  }

  return inset;
}

/**
 * Tracks whether a scroller has content past either edge, and how deep the
 * sticky headers there run.
 *
 * A static edge fade is wrong at rest: it dims the first row when nothing is
 * above it, which reads as disabled rather than continuing. Both edges are
 * therefore observed, not assumed.
 *
 * Content height is watched as well as scroll position — the list is windowed,
 * so it grows and shrinks without any scroll event firing.
 */
export function useScrollEdges(viewport: HTMLElement | null): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(EMPTY);

  useEffect(() => {
    if (viewport == null) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const next: ScrollEdges = {
        top: scrollTop > EPSILON,
        bottom: scrollTop + clientHeight < scrollHeight - EPSILON,
        topInset: insetAt(viewport, 'top'),
        bottomInset: insetAt(viewport, 'bottom'),
      };
      setEdges((prev) =>
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.topInset === next.topInset &&
        prev.bottomInset === next.bottomInset
          ? prev
          : next,
      );
    };

    // Coalesced: scroll fires far more often than the mask can change.
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

  return edges;
}
