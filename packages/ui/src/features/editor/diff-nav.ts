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
import { MergeView } from '@codemirror/merge';

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

/** Navigate to the next diff chunk; wraps to the first if past the last. */
export function nextChange(): void {
  if (!activeMergeView) return;
  const { b, chunks } = activeMergeView;
  if (!chunks.length) return;

  const pos = b.state.selection.main.anchor;
  const next = chunks.find((c) => c.fromB > pos);
  const target = next ?? chunks[0]!;
  b.dispatch({ selection: { anchor: target.fromB, head: target.fromB }, scrollIntoView: true });
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
  b.dispatch({ selection: { anchor: target.fromB, head: target.fromB }, scrollIntoView: true });
}
