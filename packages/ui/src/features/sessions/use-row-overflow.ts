/**
 * useRowOverflow — single-row "fill the available width, then +N more" measurement.
 *
 * The sidebar filter bars (projects, tags) used to collapse at a hardcoded pill
 * count, so they hid pills while space was still free. This hook instead measures
 * how many leading pills actually fit on one row and exposes that count; the
 * caller renders the rest behind a "+N more" toggle.
 *
 * The owning component must render its row children in this exact order so the
 * measured widths line up by index:
 *
 *   [ leadingCount fixed children ][ itemCount pills ][ trailingCount fixed children ][ the more toggle ]
 *
 * During the measuring pass the component renders ALL pills (plus the more
 * toggle) so every width can be read; the slice is applied synchronously in a
 * layout effect, before paint, so the full row never flashes.
 *
 * jsdom safety: when the container reports a 0 content width (unmeasured / no
 * layout, as in tests without stubbed dimensions) the hook shows everything and
 * never collapses.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface RowWidths {
  leading: number;
  items: number[];
  trailing: number;
  more: number;
  padX: number;
  leadingCount: number;
  trailingCount: number;
}

export interface RowOverflowConfig {
  /** Number of collapsible pills rendered between the leading and trailing children. */
  itemCount: number;
  /** Count of always-shown children rendered BEFORE the pills (e.g. an "All" pill or "Tags" label). */
  leadingCount: number;
  /** Count of always-shown children rendered AFTER the pills (e.g. "Add project"). */
  trailingCount: number;
  /** Flex `gap` between row children, in px, for the width math. */
  gapPx: number;
  /** Changes whenever pill identity/order/size changes, forcing a re-measure. */
  signature: string;
}

export interface RowOverflowResult {
  /** Callback ref for the row container. A callback (not a RefObject) so the
   *  ResizeObserver re-binds whenever the node mounts — load-bearing for bars
   *  that render null until their data arrives (e.g. TagFilterBar). */
  containerRef: (el: HTMLDivElement | null) => void;
  /** Leading pills to render when collapsed; equals `itemCount` while measuring. */
  visibleCount: number;
  /** True on the measuring pass — render ALL pills + the more toggle so widths can be read. */
  measuring: boolean;
}

/** Bias the fit toward leaving the row uncrowded, absorbing sub-pixel slack so
 *  the trailing controls (Add project / "+N more") never spill past the edge. */
const SAFETY_PX = 2;

function fitCount(clientWidth: number, w: RowWidths, gap: number): number {
  const count = w.items.length;
  const avail = clientWidth - w.padX - SAFETY_PX;
  if (avail <= 0) return count; // unmeasured (no layout / jsdom) → show everything

  const widthOf = (n: number, withMore: boolean): number => {
    let sum = w.leading + w.trailing + (withMore ? w.more : 0);
    for (let k = 0; k < n; k++) sum += w.items[k] ?? 0;
    const elems = w.leadingCount + n + w.trailingCount + (withMore ? 1 : 0);
    return sum + gap * Math.max(0, elems - 1);
  };

  if (widthOf(count, false) <= avail) return count; // all pills fit, no toggle needed
  let n = count;
  while (n > 0 && widthOf(n, true) > avail) n--;
  return n;
}

export function useRowOverflow({
  itemCount,
  leadingCount,
  trailingCount,
  gapPx,
  signature,
}: RowOverflowConfig): RowOverflowResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef<RowWidths | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const gapRef = useRef(gapPx);
  gapRef.current = gapPx;
  const [measuring, setMeasuring] = useState(true);
  const [visibleCount, setVisibleCount] = useState(itemCount);

  // A new item set invalidates cached widths — re-enter the measuring pass.
  useLayoutEffect(() => {
    setMeasuring(true);
  }, [signature]);

  useLayoutEffect(() => {
    if (!measuring) return;
    const el = containerRef.current;
    if (!el) return;

    // Fractional widths (getBoundingClientRect), not integer offsetWidth: summing
    // many integer-rounded pill widths underestimates the row and lets the
    // trailing "+N more" spill past the clipped edge at large tag/project counts.
    const widthOf = (node?: HTMLElement): number => (node ? node.getBoundingClientRect().width : 0);
    const kids = Array.from(el.children) as HTMLElement[];
    let i = 0;
    let leading = 0;
    for (let k = 0; k < leadingCount; k++) leading += widthOf(kids[i++]);
    const items: number[] = [];
    for (let k = 0; k < itemCount; k++) items.push(widthOf(kids[i++]));
    let trailing = 0;
    for (let k = 0; k < trailingCount; k++) trailing += widthOf(kids[i++]);
    const more = widthOf(kids[i]);

    const cs = window.getComputedStyle(el);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);

    widthsRef.current = { leading, items, trailing, more, padX, leadingCount, trailingCount };
    setVisibleCount(fitCount(el.clientWidth, widthsRef.current, gapPx));
    setMeasuring(false);
  }, [measuring, itemCount, leadingCount, trailingCount, gapPx]);

  // Callback ref: (re)bind the ResizeObserver whenever the node mounts. Bars that
  // render null until their data loads (TagFilterBar) attach the node AFTER the
  // first commit — a one-shot effect would observe a null container and never
  // re-run, so the bar would never react to sidebar resizes.
  const setContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const w = widthsRef.current;
        if (w) setVisibleCount(fitCount(el.clientWidth, w, gapRef.current));
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  return { containerRef: setContainer, visibleCount: measuring ? itemCount : visibleCount, measuring };
}
