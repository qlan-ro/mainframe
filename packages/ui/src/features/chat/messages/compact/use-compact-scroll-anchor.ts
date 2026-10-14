import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranscriptScroll } from '../../thread/transcript-scroll-context';

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

function restoreOffset(row: HTMLElement | null, viewport: HTMLElement, offset: number) {
  if (!row) return;
  const delta = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - offset;
  viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + delta));
}

export function useCompactScrollAnchor(open: boolean) {
  const rowRef = useRef<HTMLDivElement>(null);
  const controller = useTranscriptScroll();
  const pending = useRef<{ viewport: HTMLElement; offset: number; release?: () => void } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const beforeToggle = (automatic = false) => {
    cleanup.current?.();
    const row = rowRef.current;
    const viewport = row && (scrollParent(row) ?? controller?.viewportElement.current);
    if (!row || !viewport) return;
    if (automatic && controller?.isFollowing()) return;
    const release = controller?.beginInteraction();
    pending.current = {
      viewport,
      offset: row.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      release,
    };
  };
  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor) return;
    pending.current = null;
    restoreOffset(rowRef.current, anchor.viewport, anchor.offset);
    const timeout = setTimeout(() => {
      anchor.release?.();
      cleanup.current = null;
    }, 200);
    cleanup.current = () => {
      clearTimeout(timeout);
      anchor.release?.();
    };
  }, [open]);
  useEffect(
    () => () => {
      cleanup.current?.();
      pending.current?.release?.();
    },
    [],
  );
  return { rowRef, beforeToggle };
}
