/**
 * diff-nav — next/prev change chunk navigation for CmDiffEditor.
 *
 * Maintains a singleton ref to the currently active MergeView so that external
 * controls (header buttons, keyboard shortcuts) can navigate without needing a
 * prop callback chain.
 *
 * Port of the desktop `diff-nav.ts`; adapted for @codemirror/merge's Chunk API
 * instead of Monaco's `getLineChanges()`.
 *
 * Navigation dispatches selection + scrollIntoView transactions to the b
 * (modified) EditorView. Chunks are read from `mv.chunks` at call time so
 * there is no need to re-register when the diff recomputes.
 */
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Chunk, MergeView } from '@codemirror/merge';

// ── Singleton ref ────────────────────────────────────────────────────────────

let activeMergeView: MergeView | null = null;

/**
 * Register (or force-clear with `null`) the active MergeView for global
 * navigation. Single global ref → last-mount-wins (only one diff drives the nav
 * controls at a time). Production unmount should use `clearActiveMergeView`.
 */
export function setActiveMergeView(mv: MergeView | null): void {
  activeMergeView = mv;
}

/**
 * Clear the active MergeView on unmount — but ONLY if `mv` is the one currently
 * registered, so a later-mounted diff isn't clobbered by an earlier one's
 * teardown. A second concurrent diff would need a per-view registry.
 */
export function clearActiveMergeView(mv: MergeView): void {
  if (activeMergeView === mv) activeMergeView = null;
}

// ── Navigation helpers ───────────────────────────────────────────────────────

/**
 * Move the cursor to a chunk's start and scroll it fully into view on BOTH
 * axes.
 *
 * The transaction-spec shorthand `scrollIntoView: true` collapses any
 * selection to a single cursor point before computing the scroll rect (see
 * CodeMirror's own `updateState`), so a target built only from `fromB`
 * (always column 0 of the chunk's first line) never needs to scroll right —
 * it always reports the change as "in view" even when the actual changed
 * text on that line extends past the pane's visible width, leaving it
 * horizontally clipped. Dispatching `EditorView.scrollIntoView` as an
 * explicit effect over the chunk's full `fromB..toB` range instead makes
 * CodeMirror compute the rect from BOTH range endpoints, covering the
 * chunk's real horizontal (and vertical) extent.
 */
function scrollChunkIntoView(b: MergeView['b'], chunk: Chunk): void {
  b.dispatch({
    selection: { anchor: chunk.fromB, head: chunk.fromB },
    effects: EditorView.scrollIntoView(EditorSelection.range(chunk.fromB, chunk.toB), {
      y: 'nearest',
      x: 'nearest',
    }),
  });
}

/** Navigate to the next diff chunk; wraps to the first if past the last. */
export function nextChange(): void {
  if (!activeMergeView) return;
  const { b, chunks } = activeMergeView;
  if (!chunks.length) return;

  const pos = b.state.selection.main.anchor;
  const next = chunks.find((c) => c.fromB > pos);
  const target = next ?? chunks[0]!;
  scrollChunkIntoView(b, target);
}

/**
 * Return the number of diff chunks in the currently-active MergeView.
 * Returns 0 when no MergeView is registered (safe to call unconditionally).
 */
export function getActiveChangeCount(): number {
  return activeMergeView?.chunks.length ?? 0;
}

/** Navigate to the previous diff chunk; wraps to the last if before the first. */
export function prevChange(): void {
  if (!activeMergeView) return;
  const { b, chunks } = activeMergeView;
  if (!chunks.length) return;

  const pos = b.state.selection.main.anchor;
  const prev = [...chunks].reverse().find((c) => c.fromB < pos);
  const target = prev ?? chunks[chunks.length - 1]!;
  scrollChunkIntoView(b, target);
}
