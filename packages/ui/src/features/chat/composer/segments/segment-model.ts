/**
 * Pure segment-composition transitions for the multi-quote composer
 * (Variant F, spec §2.2). No React, no zustand, no aui import — client-only
 * shape, not a daemon contract, so it does not live in @qlan-ro/mainframe-types.
 */

export interface Segment {
  id: string;
  quote: string | null;
  text: string;
}

export interface Composition {
  /** s0..s(N-1): each with its own quote and its own prose (a plain <textarea>). */
  committed: Segment[];
  /** sN's quote, if any. Its prose is the native composer's text — never stored here. */
  liveQuote: { id: string; text: string } | null;
}

export function mintSegmentId(): string {
  return crypto.randomUUID();
}

/**
 * Commit-and-clear (spec §2.2): the live box's pending quote + its typed
 * prose become one committed segment, then a fresh liveQuote is minted for
 * the newly appended quote. A blank quoteless live segment commits nothing.
 */
export function appendQuote(
  composition: Composition,
  { quote, liveText }: { quote: string; liveText: string },
): Composition {
  const { committed, liveQuote } = composition;
  const shouldCommit = liveQuote != null || liveText.trim() !== '';

  const nextCommitted = shouldCommit
    ? [...committed, { id: liveQuote?.id ?? mintSegmentId(), quote: liveQuote?.text ?? null, text: liveText }]
    : committed;

  return { committed: nextCommitted, liveQuote: { id: mintSegmentId(), text: quote } };
}

/**
 * Dismiss(id): the live quote clears to null (native draft untouched).
 * A committed segment loses its quote but keeps its prose, unless that
 * prose is empty/whitespace-only, in which case the segment is removed.
 */
export function dismissQuote(composition: Composition, id: string): Composition {
  const { committed, liveQuote } = composition;

  if (liveQuote?.id === id) {
    return { committed, liveQuote: null };
  }

  const nextCommitted = committed
    .map((segment) => (segment.id === id ? { ...segment, quote: null } : segment))
    .filter((segment) => segment.id !== id || segment.text.trim() !== '');

  return { committed: nextCommitted, liveQuote };
}

/**
 * Edits a committed segment's prose in place (the plain `<textarea>` a
 * committed box renders — the live segment's prose has no store-side
 * counterpart to edit, it lives only in the native composer input).
 */
export function updateSegmentText(composition: Composition, id: string, text: string): Composition {
  return {
    ...composition,
    committed: composition.committed.map((segment) => (segment.id === id ? { ...segment, text } : segment)),
  };
}
