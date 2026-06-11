import type { EditorView } from '@codemirror/view';

/**
 * Apply a new value to a CM6 EditorView while preserving the cursor position
 * and scroll offset on external buffer updates (e.g. file-changed-on-disk
 * reload, or daemon context.updated event).
 *
 * CM6 equivalent of the Monaco `applyValueUpdate`: replaces the entire doc
 * with a single transaction that also restores the prior selection (clamped
 * to the new doc length) and the scroll position. No-ops when the value is
 * unchanged so the editor does not flicker on spurious re-renders.
 *
 * Behavior contract (matches the Monaco original, issue #151 fix):
 *   1. Save selection + scroll before touching the doc.
 *   2. Replace the doc content.
 *   3. Restore the selection (clamped) in the same transaction.
 *   4. Re-apply scroll after dispatch (scrollDOM is a DOM side-effect, not a
 *      CM6 state concern, so it must run after the transaction is committed).
 */
export function applyValueUpdate(view: EditorView, nextValue: string): void {
  if (view.state.doc.toString() === nextValue) return;

  // Snapshot state before modifying so we can restore it.
  const { anchor, head } = view.state.selection.main;
  const scrollTop = view.scrollDOM.scrollTop;
  const docLen = nextValue.length;

  // Clamp selection to the new doc length — the new content may be shorter.
  const safeAnchor = Math.min(anchor, docLen);
  const safeHead = Math.min(head, docLen);

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextValue },
    selection: { anchor: safeAnchor, head: safeHead },
  });

  // Restore scroll as a DOM side-effect after the transaction is committed.
  view.scrollDOM.scrollTop = scrollTop;
}
