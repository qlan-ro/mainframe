/**
 * diff-nav unit tests.
 *
 * Tests the setActiveMergeView / nextChange / prevChange API without any DOM
 * or React rendering. We build a minimal stub that matches the MergeView shape
 * used by diff-nav (only `b` and `chunks` are read) so we can assert position
 * navigation without mounting a real MergeView.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { setActiveMergeView, nextChange, prevChange, getActiveChangeCount } from '../diff-nav';
import { EditorState } from '@codemirror/state';
import type { StateEffect } from '@codemirror/state';
import type { MergeView, Chunk } from '@codemirror/merge';

// ── Helpers ──────────────────────────────────────────────────────────────────

type DispatchedTx = {
  scrollIntoView?: boolean;
  selection?: { anchor: number; head: number };
  effects?: StateEffect<unknown> | readonly StateEffect<unknown>[];
};

/**
 * Normalize a transaction's `effects` (single effect | array | undefined) into
 * a flat array, matching how CodeMirror itself accepts the TransactionSpec.
 */
function effectsOf(tx: DispatchedTx): readonly StateEffect<unknown>[] {
  const { effects } = tx;
  if (!effects) return [];
  // `Array.isArray` doesn't narrow a `T | readonly T[]` union cleanly (the
  // predicate's `any[]` result type isn't assignable back to `readonly T[]`),
  // so the branches are cast explicitly instead of relying on inference.
  return Array.isArray(effects) ? (effects as readonly StateEffect<unknown>[]) : [effects as StateEffect<unknown>];
}

/** Shape of the `ScrollTarget` value carried by a CodeMirror `scrollIntoView` effect. */
interface ScrollTargetLike {
  range: { from: number; to: number };
  x: string;
  y: string;
}

/**
 * Build a minimal EditorView-shaped stub for the b pane.
 * Records dispatched transactions so tests can assert navigation targets.
 */
function makeBViewStub(doc: string, initialPos = 0) {
  const dispatched: DispatchedTx[] = [];
  let state = EditorState.create({ doc, selection: { anchor: initialPos, head: initialPos } });

  return {
    get state() {
      return state;
    },
    dispatch(tx: DispatchedTx) {
      dispatched.push(tx);
      if (tx.selection) {
        state = EditorState.create({
          doc,
          selection: { anchor: tx.selection.anchor, head: tx.selection.head },
        });
      }
    },
    dispatched,
  };
}

/**
 * Build a MergeView-shaped stub with controlled chunks and cursor.
 * Only `b` and `chunks` are accessed by diff-nav.
 */
function makeMergeViewStub(
  modifiedDoc: string,
  chunks: Array<{ fromA: number; toA: number; fromB: number; toB: number }>,
  cursorPos = 0,
): MergeView {
  return {
    b: makeBViewStub(modifiedDoc, cursorPos),
    chunks: chunks as unknown as Chunk[],
  } as unknown as MergeView;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getActiveChangeCount', () => {
  beforeEach(() => {
    setActiveMergeView(null);
  });

  it('returns 0 when no MergeView is registered', () => {
    expect(getActiveChangeCount()).toBe(0);
  });

  it('returns the number of chunks from the registered MergeView', () => {
    const mv = makeMergeViewStub('aaa\nbbb\n', [
      { fromA: 0, toA: 3, fromB: 0, toB: 3 },
      { fromA: 4, toA: 7, fromB: 4, toB: 7 },
    ]);
    setActiveMergeView(mv);
    expect(getActiveChangeCount()).toBe(2);
  });
});

describe('setActiveMergeView / nextChange / prevChange', () => {
  beforeEach(() => {
    setActiveMergeView(null);
  });

  it('nextChange does nothing when no active merge view is set', () => {
    expect(() => nextChange()).not.toThrow();
  });

  it('prevChange does nothing when no active merge view is set', () => {
    expect(() => prevChange()).not.toThrow();
  });

  it('nextChange does nothing when chunks array is empty', () => {
    const mv = makeMergeViewStub('hello\n', []);
    setActiveMergeView(mv);
    expect(() => nextChange()).not.toThrow();
  });

  it('nextChange moves to the first chunk after the cursor', () => {
    const doc = 'line1\nline2\nline3\n';
    const chunks = [
      { fromA: 6, toA: 11, fromB: 6, toB: 11 },
      { fromA: 12, toA: 17, fromB: 12, toB: 17 },
    ];
    // cursor at start — chunk 0 (fromB=6) is the first chunk ahead
    const mv = makeMergeViewStub(doc, chunks, 0);
    setActiveMergeView(mv);

    nextChange();

    const bView = mv.b as unknown as ReturnType<typeof makeBViewStub>;
    expect(bView.dispatched.length).toBeGreaterThan(0);
    expect(bView.dispatched[bView.dispatched.length - 1]!.selection?.anchor).toBe(6);
  });

  it('nextChange scrolls both axes into view — the scroll target spans the chunk’s full fromB..toB range, not just its start column', () => {
    // Regression test: dispatching only `selection: {anchor: fromB, head: fromB}` with
    // `scrollIntoView: true` collapses the target to a single point at the chunk's
    // first column (see CodeMirror's own updateState, which reduces any selection to
    // a cursor before computing the scroll rect). For a long changed line whose
    // content extends past that column, the change itself stays horizontally
    // clipped. The fix must scroll using the chunk's full range so CodeMirror
    // computes the rect from both endpoints — covering the actual horizontal extent.
    const doc = 'line1\nline2 is a long changed line\nline3\n';
    const chunks = [{ fromA: 6, toA: 34, fromB: 6, toB: 34 }];
    const mv = makeMergeViewStub(doc, chunks, 0);
    setActiveMergeView(mv);

    nextChange();

    const bView = mv.b as unknown as ReturnType<typeof makeBViewStub>;
    const lastTx = bView.dispatched[bView.dispatched.length - 1]!;
    const scrollEffect = effectsOf(lastTx).find((e) => 'value' in e);
    expect(scrollEffect).toBeTruthy();
    const target = (scrollEffect as unknown as { value: ScrollTargetLike }).value;
    expect(target.range.from).toBe(6);
    expect(target.range.to).toBe(34);
    expect(target.x).toBe('nearest');
    expect(target.y).toBe('nearest');
  });

  it('prevChange scrolls both axes into view — the scroll target spans the chunk’s full fromB..toB range', () => {
    const doc = 'line1\nline2 is a long changed line\nline3\n';
    const chunks = [{ fromA: 6, toA: 34, fromB: 6, toB: 34 }];
    const mv = makeMergeViewStub(doc, chunks, doc.length);
    setActiveMergeView(mv);

    prevChange();

    const bView = mv.b as unknown as ReturnType<typeof makeBViewStub>;
    const lastTx = bView.dispatched[bView.dispatched.length - 1]!;
    const scrollEffect = effectsOf(lastTx).find((e) => 'value' in e);
    expect(scrollEffect).toBeTruthy();
    const target = (scrollEffect as unknown as { value: ScrollTargetLike }).value;
    expect(target.range.from).toBe(6);
    expect(target.range.to).toBe(34);
    expect(target.x).toBe('nearest');
    expect(target.y).toBe('nearest');
  });

  it('nextChange wraps to the first chunk when cursor is past all chunks', () => {
    const doc = 'aaa\nbbb\n';
    const chunks = [{ fromA: 0, toA: 3, fromB: 0, toB: 3 }];
    const mv = makeMergeViewStub(doc, chunks, doc.length);
    setActiveMergeView(mv);

    nextChange();

    const bView = mv.b as unknown as ReturnType<typeof makeBViewStub>;
    expect(bView.dispatched.length).toBeGreaterThan(0);
    expect(bView.dispatched[bView.dispatched.length - 1]!.selection?.anchor).toBe(0);
  });

  it('prevChange moves to the last chunk before the cursor', () => {
    const doc = 'line1\nline2\nline3\n';
    const chunks = [
      { fromA: 0, toA: 5, fromB: 0, toB: 5 },
      { fromA: 6, toA: 11, fromB: 6, toB: 11 },
    ];
    // cursor at 12 — chunk 1 (fromB=6) is the last chunk before pos 12
    const mv = makeMergeViewStub(doc, chunks, 12);
    setActiveMergeView(mv);

    prevChange();

    const bView = mv.b as unknown as ReturnType<typeof makeBViewStub>;
    expect(bView.dispatched.length).toBeGreaterThan(0);
    expect(bView.dispatched[bView.dispatched.length - 1]!.selection?.anchor).toBe(6);
  });

  it('prevChange wraps to the last chunk when cursor is before all chunks', () => {
    const doc = 'aaa\nbbb\n';
    const chunks = [{ fromA: 4, toA: 7, fromB: 4, toB: 7 }];
    // cursor at 0 — before all chunks → wraps to last (fromB=4)
    const mv = makeMergeViewStub(doc, chunks, 0);
    setActiveMergeView(mv);

    prevChange();

    const bView = mv.b as unknown as ReturnType<typeof makeBViewStub>;
    expect(bView.dispatched.length).toBeGreaterThan(0);
    expect(bView.dispatched[bView.dispatched.length - 1]!.selection?.anchor).toBe(4);
  });
});
