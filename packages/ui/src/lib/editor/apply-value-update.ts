import type { EditorView } from '@codemirror/view';
import { Annotation } from '@codemirror/state';

/**
 * Marks transactions dispatched by applyValueUpdate (external/programmatic
 * content replacement). CmEditor's update listener skips onChange for these —
 * otherwise a disk-change reload would re-mark the buffer dirty and a second
 * watcher event would raise a false conflict banner.
 */
export const externalValueUpdate = Annotation.define<boolean>();

/** The span that differs between two strings, as a CM6 change spec. */
interface ChangeSpan {
  from: number;
  to: number;
  insert: string;
}

/**
 * Trim the common prefix and suffix so only the differing middle is replaced.
 * The suffix scan stops at the prefix boundary so the two never overlap
 * (e.g. 'aa' → 'a' must yield {from:1, to:2} and not double-count the 'a').
 */
function diffSpan(oldValue: string, newValue: string): ChangeSpan {
  let from = 0;
  const maxPrefix = Math.min(oldValue.length, newValue.length);
  while (from < maxPrefix && oldValue.charCodeAt(from) === newValue.charCodeAt(from)) from++;

  let oldEnd = oldValue.length;
  let newEnd = newValue.length;
  while (oldEnd > from && newEnd > from && oldValue.charCodeAt(oldEnd - 1) === newValue.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }

  return { from, to: oldEnd, insert: newValue.slice(from, newEnd) };
}

/**
 * Apply a new value to a CM6 EditorView while preserving the scroll position
 * and selection on external buffer updates (e.g. file-changed-on-disk reload,
 * or daemon context.updated event).
 *
 * Dispatches a MINIMAL change (common prefix/suffix trimmed) instead of a
 * whole-doc replace. This is what actually preserves scroll: CM6 keeps an
 * internal scroll anchor (the line block at the top of the viewport) and maps
 * it through each transaction's changes. A whole-doc replace maps every
 * position to 0, so the next measure cycle "corrects" the scroll back to the
 * top — overriding any manual scrollDOM.scrollTop restore (the previous
 * implementation; issues #151/#196). With a minimal span the anchor maps
 * correctly and the viewport stays on the content the user was reading, even
 * when lines are added or removed above it.
 *
 * The selection is likewise left to CM6's change mapping (positions outside
 * the changed span are untouched; positions inside collapse to its start),
 * which supersedes the old manual clamp. No-ops when the value is unchanged
 * so the editor does not flicker on spurious re-renders.
 */
export function applyValueUpdate(view: EditorView, nextValue: string): void {
  const currentValue = view.state.doc.toString();
  if (currentValue === nextValue) return;

  view.dispatch({
    changes: diffSpan(currentValue, nextValue),
    annotations: externalValueUpdate.of(true),
  });
}
