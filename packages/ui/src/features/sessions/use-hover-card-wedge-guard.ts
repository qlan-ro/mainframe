import { useEffect, useRef, type RefObject } from 'react';

/** Crossing the sideOffset gap between row and card must not count as leaving. */
const SLOP_PX = 8;

/** How long the pointer may rest between the row and the card before the card closes. */
const CORRIDOR_REST_MS = 250;

export interface Point {
  x: number;
  y: number;
}

/**
 * Whether `point` is on its way from `from` (the last point over the row) to the
 * card: inside the triangle they make with the card's near edge. The card hangs
 * beside the row and reaches far below it, so a straight move to its lower half
 * leaves the row at once and crosses the rows underneath.
 */
export function inCardCorridor(from: Point, point: Point, card: DOMRect): boolean {
  const edge = card.left >= from.x ? card.left : card.right;
  const reach = edge - from.x;
  if (reach === 0) return false;
  const progress = (point.x - from.x) / reach;
  if (progress < 0 || progress > 1) return false;
  const top = from.y + (card.top - SLOP_PX - from.y) * progress;
  const bottom = from.y + (card.bottom + SLOP_PX - from.y) * progress;
  return point.y >= top - SLOP_PX && point.y <= bottom + SLOP_PX;
}

/**
 * Whether a row may open its hover card right now.
 *
 * Radix opens a hover card from `pointerenter` OR `focus`, on a delay timer — so
 * clicking a row (which focuses it) pops the card open 500ms later with the
 * pointer long gone, and nothing but a later pointer move closes it again. Two
 * rows can sit wedged open at once that way, and a card that opens over an open
 * context menu takes the top dismissable layer with it, so Escape closes the card
 * instead of the menu.
 *
 * So the card follows the pointer, or a KEYBOARD focus (`:focus-visible`, which a
 * click-focused button never matches) — never a click.
 */
export function canOpenMetaCard(row: HTMLElement | null, activeElement: Element | null): boolean {
  if (!row) return false;
  if (row.matches(':hover')) return true;
  return activeElement != null && row.contains(activeElement) && activeElement.matches(':focus-visible');
}

/** Focus the keyboard put inside the card must survive a stray pointer move. */
function holdsKeyboardFocus(card: Element): boolean {
  const active = document.activeElement;
  return active != null && card.contains(active) && active.matches(':focus-visible');
}

/**
 * Radix opens a hover card from a delay timer. Under a busy main thread that
 * timer can fire AFTER the pointer already left the row — then no pointerleave
 * ever reaches trigger or content, and the card wedges open over the chat,
 * eating clicks (measured 2026-08-06, the sessions-filters load flake). While
 * the card is open, any pointer move outside the row and the card force-closes
 * it, unless the pointer is crossing from the row to the card.
 *
 * Returns whether it is crossing right now; Radix's own leave timer fires in the
 * middle of that move, and the caller has to ignore it.
 */
export function useHoverCardWedgeGuard(
  open: boolean,
  rowRef: RefObject<HTMLElement | null>,
  close: () => void,
): RefObject<boolean> {
  const crossing = useRef(false);
  const lastOverRow = useRef<Point | null>(null);

  // Tracked while closed too: the pointer usually rests on the row until the card
  // opens, and the first move after that can already be off it.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const track = (e: PointerEvent): void => {
      lastOverRow.current = { x: e.clientX, y: e.clientY };
    };
    row.addEventListener('pointermove', track, { passive: true });
    return () => row.removeEventListener('pointermove', track);
  }, [rowRef]);

  useEffect(() => {
    if (!open) return;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const within = (rect: DOMRect | undefined, { x, y }: Point, slop = 0): boolean =>
      rect != null &&
      x >= rect.left - slop &&
      x <= rect.right + slop &&
      y >= rect.top - slop &&
      y <= rect.bottom + slop;

    const onMove = (e: PointerEvent): void => {
      const point = { x: e.clientX, y: e.clientY };
      clearTimeout(rest);
      crossing.current = false;
      const row = rowRef.current?.getBoundingClientRect();
      const cardElement = document.querySelector('[data-slot="hover-card-content"]');
      const card = cardElement?.getBoundingClientRect();
      if (within(card, point)) return;
      if (within(row, point)) {
        lastOverRow.current = point;
        return;
      }
      if (cardElement && holdsKeyboardFocus(cardElement)) return;
      const from = lastOverRow.current;
      crossing.current =
        within(row, point, SLOP_PX) ||
        within(card, point, SLOP_PX) ||
        (card != null && from != null && inCardCorridor(from, point, card));
      if (crossing.current) rest = setTimeout(close, CORRIDOR_REST_MS);
      else close();
    };
    document.addEventListener('pointermove', onMove, true);
    return () => {
      clearTimeout(rest);
      crossing.current = false;
      document.removeEventListener('pointermove', onMove, true);
    };
  }, [open, rowRef, close]);

  return crossing;
}
