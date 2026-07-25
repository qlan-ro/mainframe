/**
 * Shared "Copied" delayed-close mechanism for ContextMenu copy items.
 *
 * Radix's ContextMenu.Root has no controlled open state (only `onOpenChange`
 * as an observer), so the delayed close after a copy is a bubbling Escape
 * keydown dispatched on `document` — the one DOM signal its DismissableLayer
 * treats as a dismiss request. `onOpenChange(false)` (Escape, outside click,
 * or this timer) resets the copied state and cancels any pending timer.
 *
 * Extracted from LinkWithPreview (markdown-text.tsx) so the message path
 * menu (MessagePathContextMenu) doesn't paste the mechanism a second time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseMenuCopyFeedback {
  copiedId: string | null;
  handleOpenChange: (open: boolean) => void;
  onCopySelect: (id: string, run: () => void) => (event: Event) => void;
}

export function useMenuCopyFeedback(delayMs = 900): UseMenuCopyFeedback {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const closeMenu = useCallback(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      clearTimeout(closeTimeoutRef.current);
      setCopiedId(null);
    }
  }, []);

  useEffect(() => () => clearTimeout(closeTimeoutRef.current), []);

  const onCopySelect = useCallback(
    (id: string, run: () => void) => (event: Event) => {
      event.preventDefault();
      run();
      setCopiedId(id);
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = setTimeout(closeMenu, delayMs);
    },
    [closeMenu, delayMs],
  );

  return { copiedId, handleOpenChange, onCopySelect };
}
