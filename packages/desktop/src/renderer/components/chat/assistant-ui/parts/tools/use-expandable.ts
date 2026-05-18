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
 * assistant-ui (`useThreadViewportAutoScroll`) reads `isAtBottom` from a
 * Zustand store inside its ResizeObserver callback. The store is updated by
 * the scroll event handler. Since programmatic `scrollTop = X` queues the
 * scroll event asynchronously, the order on a click is:
 *
 *   1. nudge scrollTop  (queues async scroll event)
 *   2. setOpen(true)    (schedules React render)
 *   3. React renders, ResizeObserver fires
 *   4. autoScroll reads isAtBottom — still TRUE — and snaps to bottom
 *   5. scroll event finally fires (too late)
 *
 * Fix: nudge by 2px and SYNCHRONOUSLY dispatch a `scroll` event on the
 * scroller so assistant-ui's handler runs immediately and writes
 * `isAtBottom = false` to the store. Then on resize, autoScroll reads the
 * fresh `false` and skips. Browser keeps the pill at its viewport position
 * while content extends downward. No JS counter-scroll, no visible flash.
 */
export function useExpandable<T extends HTMLElement = HTMLDivElement>(initial = false) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<T>(null);

  const toggle = useCallback(() => {
    const scroller = findScrollContainer(ref.current);
    if (scroller) {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      // assistant-ui's isAtBottom check is `Math.abs(...) < 1`, so we need
      // the nudge to land at strictly >= 1. 2px is the safe minimum given
      // sub-pixel scrollTop values (some browsers report fractional values).
      if (distanceFromBottom < 1 && scroller.scrollTop > 0) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - 2);
        // Force the scroll handler to run synchronously so the cached
        // `isAtBottom` flag in assistant-ui's store flips to false BEFORE
        // setOpen triggers the resize that consults that flag.
        scroller.dispatchEvent(new Event('scroll'));
      }
    }
    setOpen((prev) => !prev);
  }, []);

  return { open, setOpen, toggle, ref };
}
