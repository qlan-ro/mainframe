import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { applyValueUpdate, externalValueUpdate } from '../apply-value-update';

/**
 * Stub an EditorView backed by a REAL EditorState so every dispatched spec is
 * actually applied and validated by CM6 (invalid change ranges would throw).
 *
 * Scroll behavior contract: applyValueUpdate must NOT touch scrollDOM.scrollTop.
 * A whole-doc replace maps CM6's internal scroll anchor to position 0, and the
 * next measure cycle scrolls to the top regardless of any manual scrollTop
 * restore — so the fix is a minimal change span that keeps the anchor valid,
 * not a scrollTop write. The setter spy below catches regressions.
 */
function makeView(initialDoc: string, selection?: { anchor: number; head?: number }) {
  let state = EditorState.create({
    doc: initialDoc,
    selection: selection ? EditorSelection.single(selection.anchor, selection.head ?? selection.anchor) : undefined,
  });
  const specs: TransactionSpec[] = [];
  const transactions: Transaction[] = [];
  const scrollWrites: number[] = [];
  const scrollDOM = {};
  Object.defineProperty(scrollDOM, 'scrollTop', {
    get: () => 42,
    set: (v: number) => {
      scrollWrites.push(v);
    },
  });

  const view = {
    get state() {
      return state;
    },
    scrollDOM,
    dispatch(spec: TransactionSpec) {
      specs.push(spec);
      const tr = state.update(spec);
      transactions.push(tr);
      state = tr.state;
    },
  } as unknown as EditorView;

  return { view, specs, transactions, scrollWrites, getState: () => state };
}

describe('applyValueUpdate', () => {
  it('is a no-op when the value is unchanged', () => {
    const { view, specs } = makeView('same value');
    applyValueUpdate(view, 'same value');
    expect(specs).toHaveLength(0);
  });

  it('is a no-op for identical multi-line content', () => {
    const multiLine = 'line1\nline2\nline3';
    const { view, specs } = makeView(multiLine);
    applyValueUpdate(view, multiLine);
    expect(specs).toHaveLength(0);
  });

  it('updates the document to the new value', () => {
    const { view, getState } = makeView('hello world');
    applyValueUpdate(view, 'hello brave world');
    expect(getState().doc.toString()).toBe('hello brave world');
  });

  it('dispatches a minimal change span, not a whole-doc replace', () => {
    const { view, specs } = makeView('line1\nline2\nline3');
    applyValueUpdate(view, 'line1\nCHANGED\nline3');
    expect(specs).toHaveLength(1);
    expect(specs[0]?.changes).toEqual({ from: 6, to: 11, insert: 'CHANGED' });
  });

  it('dispatches an insertion-only change for appends', () => {
    const { view, specs, getState } = makeView('abc');
    applyValueUpdate(view, 'abc\ndef');
    expect(specs[0]?.changes).toEqual({ from: 3, to: 3, insert: '\ndef' });
    expect(getState().doc.toString()).toBe('abc\ndef');
  });

  it('does not let the prefix and suffix scans overlap', () => {
    const shrink = makeView('aa');
    applyValueUpdate(shrink.view, 'a');
    expect(shrink.specs[0]?.changes).toEqual({ from: 1, to: 2, insert: '' });
    expect(shrink.getState().doc.toString()).toBe('a');

    const grow = makeView('a');
    applyValueUpdate(grow.view, 'aa');
    expect(grow.specs[0]?.changes).toEqual({ from: 1, to: 1, insert: 'a' });
    expect(grow.getState().doc.toString()).toBe('aa');
  });

  it('does not dispatch an explicit selection — CM6 maps it through the change', () => {
    // Cursor at the end of doc; an insertion before it must shift it, not clamp it.
    const { view, specs, getState } = makeView('AAA\nBBB', { anchor: 7 });
    applyValueUpdate(view, 'AAAX\nBBB');
    expect(specs[0]?.selection).toBeUndefined();
    expect(getState().selection.main.anchor).toBe(8);
  });

  it('maps a selection inside the replaced span to a valid position', () => {
    const { view, getState } = makeView('hello world', { anchor: 8 });
    applyValueUpdate(view, 'hello');
    const { anchor } = getState().selection.main;
    expect(anchor).toBeLessThanOrEqual(getState().doc.length);
    expect(anchor).toBe(5);
  });

  it('never writes scrollDOM.scrollTop — scroll is preserved by CM6 anchoring', () => {
    const { view, scrollWrites } = makeView('line1\nline2\nline3');
    applyValueUpdate(view, 'line1\nCHANGED\nline3');
    expect(scrollWrites).toHaveLength(0);
  });

  it('marks the transaction as an external value update', () => {
    const { view, transactions } = makeView('original');
    applyValueUpdate(view, 'changed');
    expect(transactions[0]?.annotation(externalValueUpdate)).toBe(true);
  });

  it('handles an update to the empty string', () => {
    const { view, specs, getState } = makeView('some content');
    applyValueUpdate(view, '');
    expect(specs[0]?.changes).toEqual({ from: 0, to: 12, insert: '' });
    expect(getState().doc.toString()).toBe('');
  });
});
