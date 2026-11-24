/** Pure geometry for overlay scrollbar thumbs (S3 in design/redesign/DECISIONS.md). */

export type Axis = 'x' | 'y';

/** One scroller measured along one axis, in px. */
export interface AxisMetrics {
  /** Visible length (`clientHeight` / `clientWidth`). */
  view: number;
  /** Content length (`scrollHeight` / `scrollWidth`). */
  full: number;
  /** Scroll offset. */
  position: number;
}

export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export const THUMB_INSET = 2;
export const THUMB_MIN_LENGTH = 24;
/** The grab area across the axis: the widened thumb plus its inset. */
export const THUMB_HIT_SIZE = 10;
/** A thumb clipped shorter than this by its surroundings is not worth drawing. */
const MIN_VISIBLE_LENGTH = 8;

export function overflows({ view, full }: AxisMetrics): boolean {
  return view > 0 && full > view + 1;
}

function trackLength(view: number): number {
  return Math.max(0, view - 2 * THUMB_INSET);
}

export function thumbLength(metrics: AxisMetrics): number {
  const track = trackLength(metrics.view);
  return Math.min(track, Math.max(THUMB_MIN_LENGTH, (track * metrics.view) / metrics.full));
}

/** Distance from the scroller's start edge to the thumb's start. */
export function thumbOffset(metrics: AxisMetrics): number {
  const travel = trackLength(metrics.view) - thumbLength(metrics);
  const range = Math.max(1, metrics.full - metrics.view);
  const progress = Math.min(1, Math.max(0, metrics.position / range));
  return THUMB_INSET + travel * progress;
}

/** How far the content scrolls for each px the thumb is dragged. */
export function scrollPerDragPixel(metrics: AxisMetrics): number {
  const travel = trackLength(metrics.view) - thumbLength(metrics);
  return (metrics.full - metrics.view) / Math.max(1, travel);
}

export function intersect(a: Box, b: Box): Box {
  return {
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

/**
 * The thumb's grab box in viewport coordinates, or null when the scroller's
 * surroundings leave nothing worth drawing. `box` is the scroller's padding box;
 * `clip` is the part of it that its ancestors leave visible.
 */
export function thumbBox(axis: Axis, metrics: AxisMetrics, box: Box, clip: Box): Box | null {
  const offset = thumbOffset(metrics);
  const length = thumbLength(metrics);
  const thumb: Box =
    axis === 'y'
      ? { top: box.top + offset, bottom: box.top + offset + length, left: box.right - THUMB_HIT_SIZE, right: box.right }
      : {
          left: box.left + offset,
          right: box.left + offset + length,
          top: box.bottom - THUMB_HIT_SIZE,
          bottom: box.bottom,
        };
  const visible = intersect(thumb, clip);
  const along = axis === 'y' ? visible.bottom - visible.top : visible.right - visible.left;
  const across = axis === 'y' ? visible.right - visible.left : visible.bottom - visible.top;
  return along < Math.min(MIN_VISIBLE_LENGTH, length) || across < THUMB_HIT_SIZE ? null : visible;
}
