import { useEffect } from 'react';

/** Crossing the sideOffset gap between row and card must not count as leaving. */
const SLOP_PX = 8;

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

/**
 * Radix opens a hover card from a delay timer. Under a busy main thread that
 * timer can fire AFTER the pointer already left the row — then no pointerleave
 * ever reaches trigger or content, and the card wedges open over the chat,
 * eating clicks (measured 2026-08-06, the sessions-filters load flake). While
 * the card is open, any pointer move outside the row and the card force-closes it.
 */
export function useHoverCardWedgeGuard(
  open: boolean,
  rowRef: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const within = (rect: DOMRect, x: number, y: number): boolean =>
      x >= rect.left - SLOP_PX && x <= rect.right + SLOP_PX && y >= rect.top - SLOP_PX && y <= rect.bottom + SLOP_PX;
    const onMove = (e: PointerEvent): void => {
      const row = rowRef.current?.getBoundingClientRect();
      if (row && within(row, e.clientX, e.clientY)) return;
      const card = document.querySelector('[data-slot="hover-card-content"]')?.getBoundingClientRect();
      if (card && within(card, e.clientX, e.clientY)) return;
      close();
    };
    document.addEventListener('pointermove', onMove, true);
    return () => document.removeEventListener('pointermove', onMove, true);
  }, [open, rowRef, close]);
}
