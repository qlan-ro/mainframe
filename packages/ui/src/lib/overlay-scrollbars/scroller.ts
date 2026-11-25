/** Reading scroll containers from the DOM. */
import { intersect, overflows, THUMB_HIT_SIZE, type Axis, type AxisMetrics, type Box, type Span } from './geometry';

const SCROLLABLE = new Set(['auto', 'scroll']);

/** Strips that scroll but show no thumb (tab rows): `data-scrollbar="none"`. */
function optedOut(element: Element): boolean {
  return element.getAttribute('data-scrollbar') === 'none';
}

export function metricsOf(element: Element, axis: Axis): AxisMetrics {
  return axis === 'y'
    ? { view: element.clientHeight, full: element.scrollHeight, position: element.scrollTop }
    : { view: element.clientWidth, full: element.scrollWidth, position: element.scrollLeft };
}

export function scrolls(element: Element, axis: Axis): boolean {
  if (!overflows(metricsOf(element, axis)) || optedOut(element)) return false;
  const style = getComputedStyle(element);
  return SCROLLABLE.has(axis === 'y' ? style.overflowY : style.overflowX);
}

export function scrollsAnyAxis(element: Element): boolean {
  return scrolls(element, 'y') || scrolls(element, 'x');
}

/** The nearest scroll container at or above `node`, up to the document root. */
export function scrollerAt(node: Element | null): Element | null {
  for (let el = node; el && el !== document.documentElement && el !== document.body; el = el.parentElement) {
    if (scrollsAnyAxis(el)) return el;
  }
  return null;
}

/** The scroller's padding box, where its content shows. */
export function paddingBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  const top = rect.top + element.clientTop;
  const left = rect.left + element.clientLeft;
  return { top, left, right: left + element.clientWidth, bottom: top + element.clientHeight };
}

/** What the scroller's clipping ancestors and the window leave visible of it. */
export function visibleBox(element: Element): Box {
  let box = intersect(paddingBox(element), { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight });
  for (let el = element.parentElement; el && el !== document.body; el = el.parentElement) {
    if (getComputedStyle(el).overflow !== 'visible') box = intersect(box, paddingBox(el));
  }
  return box;
}

/** A point `along` the axis (in the viewport) and `across` px in from the scroller's edge. */
function pointAt(axis: Axis, box: Box, along: number, across: number): [number, number] {
  return axis === 'y' ? [box.right - across, along] : [along, box.bottom - across];
}

/** What is painted at a point, topmost first. Thumbs are aside: they sit above everything and cover nothing. */
function paintedAt([x, y]: [number, number]): Element[] {
  if (typeof document.elementsFromPoint !== 'function') return [];
  return document.elementsFromPoint(x, y).filter((el) => !el.closest('.mf-scrollbar'));
}

/**
 * A resize strip along the scroller's edge (`data-edge-handle`). It is invisible
 * until hovered and shares its pixels with the thumb, so it does not cover it.
 */
function isEdgeHandle(el: Element): boolean {
  return el.closest('[data-edge-handle]') !== null;
}

/** Whether a point of the window is uncovered, for the points hit-tested so far. */
export type HitCache = Map<string, boolean>;

/** Close enough that nothing the pointer can aim at hides between two samples. */
const SAMPLE_STEP = 8;

/**
 * The parts of the thumb's box, in px along it, that nothing else (a dialog, a
 * popover, the sticky composer) is painted over. The thumb sits above every
 * portal, so it must not draw or take clicks where something covers its scroller.
 * A hit test lays the page out, so what is in `hits` is not tested again.
 */
export function uncoveredSpans(element: Element, axis: Axis, box: Box, hits: HitCache): Span[] {
  const [start, end] = axis === 'y' ? [box.top, box.bottom] : [box.left, box.right];
  const isOpen = (along: number): boolean => {
    const point = pointAt(axis, box, along, THUMB_HIT_SIZE / 2);
    const key = point.join();
    let open = hits.get(key);
    if (open === undefined) {
      const painted = paintedAt(point).filter((el) => !isEdgeHandle(el));
      open = painted.length === 0 || element.contains(painted[0]!);
      hits.set(key, open);
    }
    return open;
  };
  /** The whole pixel on the open side of where the answer changes between two points. */
  const boundary = (before: number, after: number): number => {
    const open = isOpen(before);
    while (after - before > 0.5) {
      const middle = (before + after) / 2;
      if (isOpen(middle) === open) before = middle;
      else after = middle;
    }
    return open ? Math.floor(before) : Math.ceil(after);
  };

  // Samples sit on a grid of the window, not of the thumb, so a thumb that moves finds most of them in `hits`.
  const first = Math.round(start + 1);
  const last = Math.max(Math.round(end - 1), first);
  const spans: Span[] = [];
  let previous = first;
  let from = isOpen(first) ? start : null;
  while (previous < last) {
    const at = Math.min(Math.floor(previous / SAMPLE_STEP + 1) * SAMPLE_STEP, last);
    const open = isOpen(at);
    if (open && from === null) from = boundary(previous, at);
    else if (!open && from !== null) {
      spans.push([from - start, boundary(previous, at) - start]);
      from = null;
    }
    previous = at;
  }
  if (from !== null) spans.push([from - start, end - start]);
  return spans;
}

export function hasEdgeHandle(axis: Axis, box: Box): boolean {
  const [from, to] = axis === 'y' ? [box.top, box.bottom] : [box.left, box.right];
  return [from + 2, (from + to) / 2, to - 2].some((along) =>
    paintedAt(pointAt(axis, box, along, 1)).some(isEdgeHandle),
  );
}
