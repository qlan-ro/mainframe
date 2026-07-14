/**
 * useRowHoverCard — hover-state for a session row's SessionMetaCard.
 *
 * Captures the hovered element's DOMRect after the shared TOOLTIP_DELAY_MS
 * (0 under test, 500ms live — same latency as every other hint in the app),
 * so a fast mouse pass over the list doesn't flash a card per row. Leaving
 * before the delay elapses cancels the pending show.
 */
import { useCallback, useRef, useState, type MouseEvent } from 'react';
import { TOOLTIP_DELAY_MS } from '@/components/ui/tooltip';

export interface UseRowHoverCardResult {
  rect: DOMRect | null;
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}

export function useRowHoverCard(): UseRowHoverCardResult {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMouseEnter = useCallback((e: MouseEvent<HTMLElement>) => {
    const target = e.currentTarget;
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRect(target.getBoundingClientRect()), TOOLTIP_DELAY_MS);
  }, []);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRect(null);
  }, []);

  return { rect, onMouseEnter, onMouseLeave };
}
