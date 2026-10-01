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
 * mounted part, not one per part. Performance (independent review round 2,
 * finding 4): a naive "recompute every registered entry on every mount AND
 * every selectionchange" is quadratic to mount (+170ms at 2k parts, +830ms
 * at 4k) and O(n) per keystroke-adjacent selection change (WebKit can fire
 * `selectionchange` per composer keystroke). So:
 *  - mounting only evaluates the ONE new entry against whatever selection
 *    already exists — never the already-registered ones;
 *  - a `held` set tracks who's currently held, so a null/collapsed range
 *    only has to walk (and release) THAT set, not every registration;
 *  - a non-collapsed range resolves its owning part(s) via `closest()` on
 *    the Range's start/end containers — O(1) for the overwhelmingly common
 *    single-part selection. `Range.intersectsNode` only runs, and only over
 *    the `[data-text-part]` elements inside the selection's own common
 *    ancestor (not every registration), for the rare multi-part selection.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

interface HoldEntry {
  readonly container: HTMLElement;
  readonly setHeld: (held: boolean) => void;
}

/** Keyed by container for O(1) lookup once a part container is identified. */
const entries = new Map<HTMLElement, HoldEntry>();
/** Entries currently reporting `held: true` — the only ones a release pass needs to touch. */
const held = new Set<HoldEntry>();
let listening = false;

function currentNonCollapsedRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  // `Selection.collapsed` is unreliable across environments (notably jsdom);
  // `Range.collapsed` is DOM-core and the trustworthy signal either way.
  return range.collapsed ? null : range;
}

function closestPartContainer(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const el = node instanceof Element ? node : node.parentElement;
  return (el?.closest('[data-text-part]') as HTMLElement | null) ?? null;
}

/** Marks every currently-`held` entry NOT in `keep` as released. A no-op scan over `held`, never over `entries`. */
function releaseExcept(keep: ReadonlySet<HoldEntry>): void {
  for (const entry of held) {
    if (keep.has(entry)) continue;
    held.delete(entry);
    entry.setHeld(false);
  }
}

function markHeld(container: HTMLElement, matched: Set<HoldEntry>): void {
  const entry = entries.get(container);
  if (!entry) return;
  matched.add(entry);
  if (!held.has(entry)) {
    held.add(entry);
    entry.setHeld(true);
  }
}

function recomputeFromSelection(): void {
  const range = currentNonCollapsedRange();
  if (range === null) {
    releaseExcept(new Set());
    return;
  }

  const startContainer = closestPartContainer(range.startContainer);
  const endContainer = closestPartContainer(range.endContainer);
  const matched = new Set<HoldEntry>();

  // Common case: both boundaries resolve to the SAME part (or one boundary
  // sits outside any part, e.g. a selection starting in plain chrome text) —
  // no need to scan the DOM at all.
  if (startContainer === endContainer) {
    if (startContainer) markHeld(startContainer, matched);
    releaseExcept(matched);
    return;
  }

  // Multi-part selection: bounded to the `[data-text-part]` elements inside
  // the Range's own common ancestor, not every registered entry.
  if (startContainer) markHeld(startContainer, matched);
  if (endContainer) markHeld(endContainer, matched);
  const root = range.commonAncestorContainer;
  const scanRoot = root instanceof Element ? root : root.parentElement;
  const candidates = scanRoot ? scanRoot.querySelectorAll('[data-text-part]') : [];
  for (const el of candidates) {
    if (range.intersectsNode(el)) markHeld(el as HTMLElement, matched);
  }
  releaseExcept(matched);
}

function ensureListening(): void {
  if (listening) return;
  document.addEventListener('selectionchange', recomputeFromSelection);
  listening = true;
}

function releaseListeningIfIdle(): void {
  if (entries.size === 0 && listening) {
    document.removeEventListener('selectionchange', recomputeFromSelection);
    listening = false;
  }
}

/** True while a non-collapsed document selection intersects `containerRef`'s current element. */
export function useSelectionHold(containerRef: RefObject<HTMLElement | null>): boolean {
  const [isHeld, setIsHeld] = useState(false);
  const setHeldRef = useRef(setIsHeld);
  setHeldRef.current = setIsHeld;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const entry: HoldEntry = { container, setHeld: (next) => setHeldRef.current(next) };
    entries.set(container, entry);
    ensureListening();

    // Evaluate ONLY this new entry against whatever selection already
    // exists — never a full recompute of every already-registered entry.
    const range = currentNonCollapsedRange();
    if (range && range.intersectsNode(container)) {
      held.add(entry);
      entry.setHeld(true);
    }

    return () => {
      entries.delete(container);
      held.delete(entry);
      releaseListeningIfIdle();
    };
    // containerRef's element is stable for this instance's whole lifetime —
    // only run once per mount, not on every render.
  }, []);

  return isHeld;
}
