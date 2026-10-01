/**
 * Tracks whether a non-collapsed document selection intersects a given
 * `MarkdownText` instance's DOM container — the signal `markdown-text.tsx`
 * uses to freeze that part's rendered text while the user is selecting
 * inside it (product bug: a selection made mid-stream was dropped by the
 * NEXT reveal/growth tick, because react-markdown re-parses the whole text
 * on every render and React's text-node update collapses any live `Range`
 * boundary inside a node whose `data` gets wholesale-replaced).
 *
 * ONE `document`-level `selectionchange` listener shared across every
 * mounted part, not one per part — parts register/unregister a container +
 * setter pair; the listener (added lazily on the first registration, removed
 * once the last one unregisters) recomputes every registered part's held
 * state on each selection change via `Range.intersectsNode`.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

interface HoldEntry {
  readonly container: HTMLElement;
  readonly setHeld: (held: boolean) => void;
}

const entries = new Set<HoldEntry>();
let listening = false;

function currentNonCollapsedRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  // `Selection.collapsed` is unreliable across environments (notably jsdom);
  // `Range.collapsed` is DOM-core and the trustworthy signal either way.
  return range.collapsed ? null : range;
}

function recomputeAll(): void {
  const range = currentNonCollapsedRange();
  for (const entry of entries) {
    entry.setHeld(range !== null && range.intersectsNode(entry.container));
  }
}

function ensureListening(): void {
  if (listening) return;
  document.addEventListener('selectionchange', recomputeAll);
  listening = true;
}

function releaseListeningIfIdle(): void {
  if (entries.size === 0 && listening) {
    document.removeEventListener('selectionchange', recomputeAll);
    listening = false;
  }
}

/** True while a non-collapsed document selection intersects `containerRef`'s current element. */
export function useSelectionHold(containerRef: RefObject<HTMLElement | null>): boolean {
  const [held, setHeld] = useState(false);
  const setHeldRef = useRef(setHeld);
  setHeldRef.current = setHeld;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const entry: HoldEntry = { container, setHeld: (next) => setHeldRef.current(next) };
    entries.add(entry);
    ensureListening();
    recomputeAll(); // a selection can already exist the moment this instance mounts
    return () => {
      entries.delete(entry);
      releaseListeningIfIdle();
    };
    // containerRef's element is stable for this instance's whole lifetime —
    // only run once per mount, not on every render.
  }, []);

  return held;
}
