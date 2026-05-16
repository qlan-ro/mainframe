import { useCallback, useEffect, useRef, useState } from 'react';

interface UseHorizontalResizeOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

interface UseHorizontalResizeResult {
  width: number;
  onHandleMouseDown: (e: React.MouseEvent) => void;
  resizing: boolean;
}

export function useHorizontalResize({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: UseHorizontalResizeOptions): UseHorizontalResizeResult {
  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultWidth;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return defaultWidth;
      return Math.min(Math.max(parsed, minWidth), maxWidth);
    } catch {
      /* expected — localStorage may be unavailable in some contexts */
      return defaultWidth;
    }
  });
  const [resizing, setResizing] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragState.current = { startX: e.clientX, startWidth: width };
      setResizing(true);
    },
    [width],
  );

  useEffect(() => {
    if (!resizing) return;

    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = e.clientX - dragState.current.startX;
      const next = Math.min(Math.max(dragState.current.startWidth + delta, minWidth), maxWidth);
      setWidth(next);
    };

    const onUp = () => {
      setResizing(false);
      dragState.current = null;
      try {
        window.localStorage.setItem(storageKey, String(width));
      } catch {
        /* expected — localStorage may be unavailable */
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, storageKey, width, minWidth, maxWidth]);

  return { width, onHandleMouseDown, resizing };
}
