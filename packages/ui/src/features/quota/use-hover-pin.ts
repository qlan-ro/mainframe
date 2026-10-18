/**
 * Open state for a popover that hover opens and a click pins. Hovering the
 * trigger or the content opens it after a short delay; leaving both closes it
 * unless it is pinned. A click toggles the pin, and the popover's own dismissal
 * (outside click, Escape) clears both.
 *
 * Leaving cancels a pending open, so a delayed open can never fire after the
 * pointer is gone and wedge the popover over the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const OPEN_DELAY_MS = 300;
/** Long enough to cross the gap between trigger and content without closing. */
const CLOSE_DELAY_MS = 120;

export interface HoverPin {
  open: boolean;
  /** True while the pointer is over the trigger or the content, before any delay. */
  pointerInside: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  togglePin: () => void;
  onOpenChange: (open: boolean) => void;
}

export function useHoverPin(): HoverPin {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerEnter = useCallback(() => {
    clearTimer();
    setPointerInside(true);
    timer.current = setTimeout(() => setHovered(true), OPEN_DELAY_MS);
  }, [clearTimer]);

  const onPointerLeave = useCallback(() => {
    clearTimer();
    setPointerInside(false);
    timer.current = setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
  }, [clearTimer]);

  const togglePin = useCallback(() => {
    clearTimer();
    // Unpinning closes it outright, even with the pointer still on the trigger.
    if (pinned) setHovered(false);
    setPinned(!pinned);
  }, [clearTimer, pinned]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) return;
      clearTimer();
      setPinned(false);
      setHovered(false);
    },
    [clearTimer],
  );

  return { open: hovered || pinned, pointerInside, onPointerEnter, onPointerLeave, togglePin, onOpenChange };
}
