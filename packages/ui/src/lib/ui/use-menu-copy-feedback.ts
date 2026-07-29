/**
 * Shared "Copied" delayed-close mechanism for ContextMenu copy items.
 *
 * Radix's ContextMenu.Root has no controlled open state (only `onOpenChange`
 * as an observer), so the delayed close after a copy is a bubbling Escape
 * keydown dispatched on `document` — the one DOM signal its DismissableLayer
 * treats as a dismiss request. `onOpenChange(false)` (Escape, outside click,
 * or this timer) resets the feedback state and cancels any pending timer.
 *
 * The feedback waits for the copy to resolve and reports what actually
 * happened: a rejected clipboard write (WKWebView refuses `writeText` on an
 * unfocused document) reads "Copy failed", never "Copied".
 *
 * Extracted from LinkWithPreview (markdown-text.tsx) so the message path
 * menu (MessagePathContextMenu) doesn't paste the mechanism a second time.
 *
 * A generation token drops settlements that land after the menu closed: the
 * Escape they would schedule fires with the menu gone, and inside a Dialog the
 * Dialog is then the topmost dismissable layer and closes instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'failed';

export interface UseMenuCopyFeedback {
  /** The clicked item's outcome, once its copy has settled. */
  statusFor: (id: string) => CopyStatus;
  handleOpenChange: (open: boolean) => void;
  /** `run` must resolve with whether the copy actually landed. */
  onCopySelect: (id: string, run: () => Promise<boolean>) => (event: Event) => void;
}

export function useMenuCopyFeedback(delayMs = 900): UseMenuCopyFeedback {
  const [settled, setSettled] = useState<{ id: string; ok: boolean } | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);

  const closeMenu = useCallback(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      generationRef.current += 1;
      clearTimeout(closeTimeoutRef.current);
      setSettled(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const onCopySelect = useCallback(
    (id: string, run: () => Promise<boolean>) => (event: Event) => {
      event.preventDefault();
      const generation = generationRef.current;
      void run().then((ok) => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        setSettled({ id, ok });
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = setTimeout(closeMenu, delayMs);
      });
    },
    [closeMenu, delayMs],
  );

  const statusFor = useCallback(
    (id: string): CopyStatus => {
      if (settled?.id !== id) return 'idle';
      return settled.ok ? 'copied' : 'failed';
    },
    [settled],
  );

  return { statusFor, handleOpenChange, onCopySelect };
}
