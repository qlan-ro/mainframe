/**
 * A session row's hover card: when it may open, when it must close, and how the
 * keyboard gets into it.
 *
 * Controlled rather than left to Radix: under load its open timer can fire after
 * the pointer already left the row (or on a click, which focuses it), and then
 * no pointerleave ever closes the card.
 *
 * Radix keeps everything inside a hover card out of the tab order, but ours
 * carries links. With the card open, Tab from the row goes through them and then
 * on to whatever follows the row; Escape goes back to the row.
 */
import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { canOpenMetaCard, holdsKeyboardFocus, useHoverCardWedgeGuard } from './use-hover-card-wedge-guard';

export interface SessionMetaCardState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row's context menu opened or closed; the card never shows over it. */
  onMenuOpenChange: (open: boolean) => void;
  /** Closes the card after one of its links was used. */
  closeAfterUse: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  triggerProps: { onKeyDown: (e: KeyboardEvent) => void; onBlur: () => void };
  cardProps: { onKeyDown: (e: KeyboardEvent) => void; onBlur: (e: FocusEvent) => void };
}

function linksIn(card: HTMLElement | null): HTMLElement[] {
  return card == null ? [] : [...card.querySelectorAll<HTMLElement>('a[href], button')];
}

export function useSessionMetaCard(rowRef: RefObject<HTMLElement | null>): SessionMetaCardState {
  const [open, setOpen] = useState(false);
  // Refs, not state: they only gate the card, and re-rendering the row on every
  // right-click would cost the open menu its anchor.
  const menuOpen = useRef(false);
  // Handing keyboard focus back to the row would reopen the card it was dismissed
  // from. A mouse click must not set it: hovering the row again reopens the card.
  const dismissed = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const crossing = useHoverCardWedgeGuard(open, rowRef, cardRef, close);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        // Radix starts a second open timer when the row is hovered and focused, and
        // clears only the last: the other fires after the row, or the page, is gone.
        const row = rowRef.current;
        if (row == null) return;
        setOpen(!menuOpen.current && !dismissed.current && canOpenMetaCard(row, document.activeElement));
      } else if (!crossing.current && !cardRef.current?.contains(document.activeElement)) {
        setOpen(false);
      }
    },
    [rowRef, crossing],
  );

  const onMenuOpenChange = useCallback((next: boolean) => {
    menuOpen.current = next;
    if (next) setOpen(false);
  }, []);

  const closeAfterUse = useCallback(() => {
    if (cardRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
      dismissed.current = holdsKeyboardFocus(triggerRef.current);
    }
    setOpen(false);
  }, []);

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    // The rename input sits inside the row: Tab there leaves the field, not the row.
    if (e.target instanceof HTMLInputElement) return;
    if (e.key !== 'Tab' || e.shiftKey || !open) return;
    const first = linksIn(cardRef.current)[0];
    if (first == null) return;
    e.preventDefault();
    first.focus();
  };

  const onCardKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeAfterUse();
    } else if (e.key === 'Tab') {
      const links = linksIn(cardRef.current);
      const at = links.findIndex((link) => link === document.activeElement);
      const next = links[at + (e.shiftKey ? -1 : 1)] ?? (e.shiftKey ? triggerRef.current : null);
      // Past the last link the row takes focus and the browser moves on from it.
      if (next == null) triggerRef.current?.focus();
      else {
        e.preventDefault();
        next.focus();
      }
    }
  };

  const onCardBlur = (e: FocusEvent) => {
    const to = e.relatedTarget;
    if (to instanceof Node && (cardRef.current?.contains(to) || triggerRef.current?.contains(to))) return;
    if (to != null) setOpen(false);
  };

  const onTriggerBlur = useCallback(() => {
    dismissed.current = false;
  }, []);

  return {
    open,
    onOpenChange,
    onMenuOpenChange,
    closeAfterUse,
    triggerRef,
    cardRef,
    triggerProps: { onKeyDown: onTriggerKeyDown, onBlur: onTriggerBlur },
    cardProps: { onKeyDown: onCardKeyDown, onBlur: onCardBlur },
  };
}
