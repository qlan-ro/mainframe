/** One overlay thumb: its element, its placement and dragging it. */
import { scrollPerDragPixel, THUMB_INSET, thumbBox, type Axis, type Box } from './geometry';
import { hasEdgeHandle, isCovered, metricsOf, paddingBox, scrolls, visibleBox } from './scroller';

/**
 * Fired on a scroller (not bubbling) when its thumb is grabbed. Code that tells
 * the reader's scrolling from the app's own listens for it, because the thumb
 * lives outside the scroller and its pointer events never reach it.
 */
export const SCROLLBAR_DRAG_EVENT = 'mf-scrollbar-drag';

export interface Thumb {
  element: HTMLDivElement;
  /** Moves the thumb to its scroller's current offset, or hides it. */
  place: () => void;
  setVisible: (visible: boolean) => void;
  /** Hovered or being dragged, so it must not fade. */
  isHeld: () => boolean;
  remove: () => void;
}

interface ThumbOptions {
  onEnter: () => void;
  onLeave: () => void;
}

function setScroll(scroller: Element, axis: Axis, value: number): void {
  scroller.scrollTo({ [axis === 'y' ? 'top' : 'left']: value, behavior: 'instant' });
}

function startDrag(thumb: HTMLDivElement, scroller: Element, axis: Axis, down: PointerEvent, onEnd: () => void): void {
  // Radix closes a menu or dialog on an outside pointerdown, and this thumb is
  // outside the dialog it scrolls. Focus must stay where it is, too.
  down.preventDefault();
  down.stopPropagation();
  thumb.setPointerCapture?.(down.pointerId);
  thumb.dataset.dragging = '';
  scroller.dispatchEvent(new CustomEvent(SCROLLBAR_DRAG_EVENT));
  // Each move scrolls by its own delta from where the scroller is now, so content
  // that loads above mid-drag moves the view once, with its anchor, and no more.
  let pointer = axis === 'y' ? down.clientY : down.clientX;
  let landed = metricsOf(scroller, axis).position;
  /** Scroll asked for and not given: a fraction of a px, or the pull past an end. */
  let owed = 0;
  const move = (event: PointerEvent): void => {
    const next = axis === 'y' ? event.clientY : event.clientX;
    const metrics = metricsOf(scroller, axis);
    if (metrics.position !== landed) owed = 0;
    const target = metrics.position + owed + (next - pointer) * scrollPerDragPixel(metrics);
    pointer = next;
    setScroll(scroller, axis, target);
    landed = metricsOf(scroller, axis).position;
    owed = target - landed;
  };
  const end = (): void => {
    delete thumb.dataset.dragging;
    thumb.removeEventListener('pointermove', move);
    thumb.removeEventListener('pointerup', end);
    thumb.removeEventListener('pointercancel', end);
    onEnd();
  };
  thumb.addEventListener('pointermove', move);
  thumb.addEventListener('pointerup', end);
  thumb.addEventListener('pointercancel', end);
}

/** Leaves the outermost pixels of the scroller's edge to a resize strip that shares it. */
function yieldEdge(axis: Axis, box: Box): Box {
  if (!hasEdgeHandle(axis, box)) return box;
  return axis === 'y' ? { ...box, right: box.right - THUMB_INSET } : { ...box, bottom: box.bottom - THUMB_INSET };
}

/** The thumb covers the scroller's edge, so a wheel over it has to reach the scroller. */
function forwardWheel(scroller: Element, event: WheelEvent): void {
  event.preventDefault();
  const { deltaX, deltaY, deltaMode, ctrlKey } = event;
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, deltaMode, ctrlKey }));
  if (!ctrlKey) scroller.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
}

export function createThumb(scroller: Element, axis: Axis, { onEnter, onLeave }: ThumbOptions): Thumb {
  const element = document.createElement('div');
  element.className = 'mf-scrollbar';
  element.dataset.axis = axis;
  element.setAttribute('aria-hidden', 'true');
  element.append(document.createElement('span'));
  let hovered = false;
  element.addEventListener('pointerenter', () => {
    hovered = true;
    onEnter();
  });
  element.addEventListener('pointerleave', () => {
    hovered = false;
    onLeave();
  });
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  element.addEventListener('pointerdown', (event) => {
    if (event.button === 0) startDrag(element, scroller, axis, event, onLeave);
  });
  element.addEventListener('wheel', (event) => forwardWheel(scroller, event), { passive: false });
  document.body.append(element);

  const place = (): void => {
    const full = scrolls(scroller, axis)
      ? thumbBox(axis, metricsOf(scroller, axis), paddingBox(scroller), visibleBox(scroller))
      : null;
    // Hiding the thumb mid-drag would drop its pointer capture.
    const dragging = element.dataset.dragging !== undefined;
    element.hidden = !dragging && (full === null || isCovered(scroller, axis, full));
    if (!full) return;
    const box = yieldEdge(axis, full);
    element.style.top = `${box.top}px`;
    element.style.left = `${box.left}px`;
    element.style.width = `${box.right - box.left}px`;
    element.style.height = `${box.bottom - box.top}px`;
    element.style.setProperty(
      '--thumb-inset',
      `${THUMB_INSET - (axis === 'y' ? full.right - box.right : full.bottom - box.bottom)}px`,
    );
  };

  return {
    element,
    place,
    setVisible: (visible) => element.toggleAttribute('data-visible', visible),
    isHeld: () => !element.hidden && (hovered || element.dataset.dragging !== undefined),
    remove: () => element.remove(),
  };
}
