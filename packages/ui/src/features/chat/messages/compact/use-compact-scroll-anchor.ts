import { useEffect, useLayoutEffect, useRef } from 'react';
import { useScrollLock } from '@assistant-ui/react';
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
  const lockScroll = useScrollLock(rowRef, 200);
  const pending = useRef<{ viewport: HTMLElement; offset: number; release?: () => void } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const beforeToggle = () => {
    cleanup.current?.();
    const row = rowRef.current;
    const viewport = row && (scrollParent(row) ?? controller?.viewportElement.current);
    if (!row || !viewport) return;
    const release = controller?.beginInteraction();
    pending.current = {
      viewport,
      offset: row.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      release,
    };
    lockScroll();
  };
  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor) return;
    pending.current = null;
    const restore = () => restoreOffset(rowRef.current, anchor.viewport, anchor.offset);
    restore();
    const timeout = setTimeout(() => {
      restore();
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
