'use client';

/**
 * Nothing is allowed unread (G2): while the end of what a request asks to allow
 * has not been in view, its allowing answers are locked. Overflow decides, not
 * the number of lines. An end counts once it has been in view, by any scrolling
 * or by `showRest`, for this request only; hiding it again later takes nothing back.
 *
 * Measured on mount, on scroll and on resize. Where nothing can be measured (no
 * layout, no observer) an end has simply not been in view, and `showRest` is the
 * way through.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

/** A block of what is allowed. Its element carries `data-allowed-part` with the id. */
export interface AllowedPart {
  id: string;
  /** "the command": what the button names. */
  name: string;
  text: string;
}

export interface ShownToEnd {
  /** Some end has not been in view. */
  locked: boolean;
  /** The first part whose end has been looked for and is out of view. */
  rest: AllowedPart | undefined;
  /** Scrolls to that end, and counts it as shown. */
  showRest: () => void;
}

/** A last line cut off at the top is not in view. */
const LAST_LINE_PX = 12;
/** Kept in view above the end of a part when the scroll goes on to the next. */
const CONTEXT_PX = 56;
const ROUNDING_PX = 1;

interface View {
  slot: Element;
  top: number;
  bottom: number;
}

/** What shows of the gate: its slot, down to the answers pinned in it. Null without a layout. */
function viewOf(gate: HTMLElement): View | null {
  const slot = gate.closest('[data-chat-gate]');
  const answers = gate.querySelector('[data-gate-answers]');
  if (!slot || !answers) return null;
  const box = slot.getBoundingClientRect();
  if (box.height === 0) return null;
  return { slot, top: box.top, bottom: Math.min(box.bottom, answers.getBoundingClientRect().top) };
}

const partElement = (gate: HTMLElement, id: string) => gate.querySelector<HTMLElement>(`[data-allowed-part="${id}"]`);

function endInView(element: HTMLElement | null, view: View): boolean {
  const box = element?.getBoundingClientRect();
  if (!box || box.height === 0) return false;
  return box.bottom <= view.bottom + ROUNDING_PX && box.bottom >= view.top + LAST_LINE_PX;
}

/** The end of `part` into view, and as much of what follows as leaves it there. */
function scrollToEnd(view: View, part: HTMLElement, last: HTMLElement): void {
  const end = part.getBoundingClientRect().bottom;
  const lastEnd = last.getBoundingClientRect().bottom;
  view.slot.scrollTop += Math.max(end - view.bottom, Math.min(lastEnd - view.bottom, end - view.top - CONTEXT_PX));
}

const union = (a: ReadonlySet<string>, b: readonly string[]): ReadonlySet<string> =>
  b.every((key) => a.has(key)) ? a : new Set([...a, ...b]);

export function useShownToEnd(
  gateRef: RefObject<HTMLElement | null>,
  requestId: string,
  parts: readonly AllowedPart[],
): ShownToEnd {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  // The button takes room itself: it waits until the gate was measured without it.
  const [lookedFor, setLookedFor] = useState<ReadonlySet<string>>(() => new Set());
  const keyOf = (part: AllowedPart) => `${requestId}\n${part.id}\n${part.text}`;
  const unshown = parts.filter((part) => !shown.has(keyOf(part)));
  const unshownKeys = unshown.map(keyOf);

  /** Counts every end in view, and `also`, as shown. The last one takes the focus the button loses. */
  const countShown = (also?: AllowedPart) => {
    const gate = gateRef.current;
    if (!gate) return;
    const view = viewOf(gate);
    const now = unshown.filter((part) => part === also || (view && endInView(partElement(gate, part.id), view)));
    if (now.length === 0) return;
    const button = gate.querySelector('[data-gate-show-rest]');
    if (now.length === unshown.length && button && button === document.activeElement) {
      partElement(gate, now[now.length - 1]!.id)?.focus({ preventScroll: true });
    }
    setShown((prev) => union(prev, now.map(keyOf)));
  };

  useLayoutEffect(() => {
    const gate = gateRef.current;
    if (!gate || unshown.length === 0) return;
    const measure = () => countShown();
    measure();
    setLookedFor((prev) => union(prev, unshownKeys));
    const slot = gate.closest('[data-chat-gate]');
    slot?.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (slot) observer?.observe(slot);
    observer?.observe(gate);
    return () => {
      slot?.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
    // The keys stand for the parts: their text, their request, and what is left of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unshownKeys.join('\n\n')]);

  const rest = unshown.find((part) => lookedFor.has(keyOf(part)));
  const showRest = () => {
    const gate = gateRef.current;
    if (!gate || !rest) return;
    const view = viewOf(gate);
    const element = partElement(gate, rest.id);
    const last = partElement(gate, parts[parts.length - 1]!.id);
    if (view && element && last) scrollToEnd(view, element, last);
    countShown(rest);
  };
  return { locked: unshown.length > 0, rest, showRest };
}
