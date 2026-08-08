import { useEffect } from 'react';

/** Crossing the sideOffset gap between row and card must not count as leaving. */
const SLOP_PX = 8;

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
