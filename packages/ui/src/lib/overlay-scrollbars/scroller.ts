/** Reading scroll containers from the DOM. */
import { intersect, overflows, THUMB_HIT_SIZE, type Axis, type AxisMetrics, type Box } from './geometry';

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

/** Points along a thumb's box: near both ends and in the middle, `across` px in from the scroller's edge. */
function samplePoints(axis: Axis, box: Box, across: number): [number, number][] {
  const [from, to] = axis === 'y' ? [box.top, box.bottom] : [box.left, box.right];
  return [from + 2, (from + to) / 2, to - 2].map((along) =>
    axis === 'y' ? [box.right - across, along] : [along, box.bottom - across],
  );
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

/**
 * True when something else (a dialog, the sticky composer) is painted over all of
 * the box. Part of it is not enough: a toast over one end must not take the thumb
 * away from the rest.
 */
export function isCovered(element: Element, axis: Axis, box: Box): boolean {
  return samplePoints(axis, box, THUMB_HIT_SIZE / 2).every((point) => {
    const painted = paintedAt(point).filter((el) => !isEdgeHandle(el));
    return painted.length > 0 && !element.contains(painted[0]!);
  });
}

export function hasEdgeHandle(axis: Axis, box: Box): boolean {
  return samplePoints(axis, box, 1).some((point) => paintedAt(point).some(isEdgeHandle));
}
