/** Reading scroll containers from the DOM. */
import { intersect, overflows, type Axis, type AxisMetrics, type Box } from './geometry';

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

/** True when something else (a dialog, the sticky composer) is painted over the box. */
export function isCovered(element: Element, axis: Axis, box: Box, thumb: Element): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;
  const points: [number, number][] =
    axis === 'y'
      ? [
          [midX, box.top + 2],
          [midX, midY],
          [midX, box.bottom - 2],
        ]
      : [
          [box.left + 2, midY],
          [midX, midY],
          [box.right - 2, midY],
        ];
  return points.some(([x, y]) => {
    const hit = document.elementsFromPoint(x, y).find((el) => !thumb.contains(el));
    return !hit || !(element === hit || element.contains(hit));
  });
}
