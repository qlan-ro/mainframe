import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Selectors for DOM overlays that float above page content. A native child
 * WebView composites ABOVE all DOM, so any of these that overlaps the preview
 * region would be occluded by the webview — the caller hides the webview while
 * occluded so the overlay shows (z-index can't reach across the native layer).
 *
 * Covers Radix poppers (popover / dropdown / select / tooltip / context menu /
 * hover card), dialogs/command palettes, and an opt-in `data-preview-overlay`
 * marker for any custom floating element.
 */
const OVERLAY_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-preview-overlay]',
].join(',');

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Returns `true` while any open DOM overlay visually overlaps the `anchor` rect.
 * Watches the DOM (overlay mount/unmount + state) and re-checks on scroll/resize,
 * coalesced via rAF. Only runs when `enabled` (i.e. the webview is actually shown).
 */
export function usePreviewOcclusion(anchorRef: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [occluded, setOccluded] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOccluded(false);
      return;
    }
    let raf = 0;
    const check = () => {
      raf = 0;
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor || anchor.width === 0 || anchor.height === 0) {
        setOccluded(false);
        return;
      }
      let over = false;
      for (const el of document.querySelectorAll(OVERLAY_SELECTOR)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && intersects(r, anchor)) {
          over = true;
          break;
        }
      }
      setOccluded(over);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'style'],
    });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    check();
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [anchorRef, enabled]);

  return occluded;
}
