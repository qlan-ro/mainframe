import { useCallback, useRef, useState } from 'react';

function findScrollContainer(node: HTMLElement | null): HTMLElement | null {
  let n: HTMLElement | null = node?.parentElement ?? null;
  while (n) {
    const overflowY = getComputedStyle(n).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return n;
    n = n.parentElement;
  }
  return null;
}

/**
 * Expandable cards/pills inside the chat fight assistant-ui's stick-to-bottom
 * viewport: when the user clicks one near the bottom, the new body grows
 * downward and autoScroll snaps the viewport to the new bottom — which pushes
 * the pill itself off the top of the screen.
 *
 * assistant-ui's autoScroll only fires when the viewport is within 1px of the
 * bottom (`isAtBottom`). Nudging the scroll up by 2px before the toggle
 * defeats that check: autoScroll skips the resize, and the browser keeps the
 * pill at its current viewport position while the new content extends
 * downward. No JS counter-scroll, no second paint, no visible flash.
 */
export function useExpandable<T extends HTMLElement = HTMLDivElement>(initial = false) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<T>(null);

  const toggle = useCallback(() => {
    const scroller = findScrollContainer(ref.current);
    if (scroller) {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      // assistant-ui's autoScroll uses `< 1` for isAtBottom, so 1px is enough
      // to defeat it. Anything more is just visible jitter.
      if (distanceFromBottom < 1) scroller.scrollTop = Math.max(0, scroller.scrollTop - 1);
    }
    setOpen((prev) => !prev);
  }, []);

  return { open, setOpen, toggle, ref };
}
