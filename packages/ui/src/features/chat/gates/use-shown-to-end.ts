'use client';

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
  /** Scrolls to the end and reports whether it became visible. */
  showRest: () => boolean;
  confirmRest: (part: AllowedPart) => void;
}

/** Kept in view above the end of a part when the scroll goes on to the next. */
const CONTEXT_PX = 56;

interface View {
  slot: Element;
  top: number;
  bottom: number;
}

/** What shows of the gate: its slot, down to the answers pinned in it. Null outside a slot. */
function viewOf(gate: HTMLElement): View | null {
  const slot = gate.closest('[data-chat-gate]');
  const answers = gate.querySelector('[data-gate-answers]');
  if (!slot || !answers) return null;
  const box = slot.getBoundingClientRect();
  return { slot, top: box.top, bottom: Math.min(box.bottom, answers.getBoundingClientRect().top) };
}

const partElement = (gate: HTMLElement, id: string) => gate.querySelector<HTMLElement>(`[data-allowed-part="${id}"]`);

export function lastLine(element: HTMLElement): { top: number; bottom: number } | undefined {
  const box = element.getBoundingClientRect();
  if (!box.height || !box.width) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = range.getClientRects?.();
  if (!rects) return;
  const lines = Array.from(rects).filter((rect) => rect.height > 0);
  return lines[lines.length - 1];
}

function endInView(element: HTMLElement | null, view: View): boolean {
  const line = element && lastLine(element);
  return !!line && line.top >= view.top - 1 && line.bottom <= view.bottom + 1;
}

/** The end of `part` into view, and as much of what follows as leaves it there. */
function scrollToEnd(view: View, part: HTMLElement, last: HTMLElement): void {
  const end = lastLine(part)?.bottom ?? part.getBoundingClientRect().bottom;
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
    for (const part of unshown) {
      const element = partElement(gate, part.id);
      if (element) observer?.observe(element);
    }
    window.addEventListener('resize', measure);
    return () => {
      slot?.removeEventListener('scroll', measure);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // The keys stand for the parts: their text, their request, and what is left of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unshownKeys.join('\n\n')]);

  const rest = unshown.find((part) => lookedFor.has(keyOf(part)));
  const showRest = () => {
    const gate = gateRef.current;
    if (!gate || !rest) return false;
    const view = viewOf(gate);
    const element = partElement(gate, rest.id);
    const last = partElement(gate, parts[parts.length - 1]!.id);
    if (view && element && last) scrollToEnd(view, element, last);
    countShown();
    const after = viewOf(gate);
    return !!after && endInView(element, after);
  };
  return {
    locked: unshown.length > 0,
    rest,
    showRest,
    confirmRest: (part) => {
      const current = unshown.find((candidate) => keyOf(candidate) === keyOf(part));
      if (current) countShown(current);
    },
  };
}
