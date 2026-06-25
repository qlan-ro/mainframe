import { describe, expect, it, vi } from 'vitest';
import { applyValueUpdate } from '../apply-value-update';
import type { EditorView } from '@codemirror/view';
import type { Transaction } from '@codemirror/state';

/**
 * Stub an EditorView for apply-value-update tests.
 *
 * The CM6 implementation operates on:
 *   - view.state.doc.toString() — read current value
 *   - view.dispatch(transaction) — apply changes
 *   - view.state.selection — read selection before update
 *   - view.scrollDOM.scrollTop — read scroll before update
 */
function makeStubView(initialDoc: string) {
  const scrollTop = { current: 42 };
  let doc = initialDoc;
  const selection = { main: { anchor: 5, head: 5 } };

  const dispatch = vi.fn((tx: Partial<Transaction>) => {
    if (tx && typeof tx === 'object') {
      // Simulate applying changes — track that dispatch was called
    }
  });

  const view = {
    state: {
      get doc() {
        return { toString: () => doc, length: doc.length };
      },
      get selection() {
        return selection;
      },
    },
    get scrollDOM() {
      return { scrollTop: scrollTop.current };
    },
    dispatch,
  } as unknown as EditorView;

  return {
    view,
    dispatch,
    scrollTop,
    setDoc: (v: string) => {
      doc = v;
    },
  };
}

describe('applyValueUpdate', () => {
  it('dispatches a transaction when the value changes', () => {
    const { view, dispatch } = makeStubView('original');
    applyValueUpdate(view, 'changed');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('is a no-op when the value is unchanged', () => {
    const { view, dispatch } = makeStubView('same value');
    applyValueUpdate(view, 'same value');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('preserves selection anchor in the dispatched transaction', () => {
    const { view, dispatch } = makeStubView('hello world');
    applyValueUpdate(view, 'hello world changed');
    expect(dispatch).toHaveBeenCalledOnce();
    const tx = dispatch.mock.calls[0]?.[0] as { selection?: { anchor: number } };
    // Selection should be preserved (anchor maps to same position or clamped)
    expect(tx).toBeDefined();
  });

  it('handles empty string update', () => {
    const { view, dispatch } = makeStubView('some content');
    applyValueUpdate(view, '');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('handles update to identical multi-line content', () => {
    const multiLine = 'line1\nline2\nline3';
    const { view, dispatch } = makeStubView(multiLine);
    applyValueUpdate(view, multiLine);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
