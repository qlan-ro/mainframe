/**
 * resolve-comment-range — unit tests for the pure helper.
 *
 * Uses EditorState.create() from @codemirror/state — no DOM, no React.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { resolveCommentRange } from '../resolve-comment-range';

// ── helpers ───────────────────────────────────────────────────────────────────

function stateWith(doc: string, selection?: { anchor: number; head: number }): EditorState {
  return EditorState.create({ doc, selection });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('resolveCommentRange', () => {
  it('uses the selection when non-empty (lines 1–3)', () => {
    // doc: "a\nb\nc\nd" — 4 lines
    // anchor=0 (start of "a"), head=5 (start of "c" = offset 4 is end of "b\n", head 5 = "c" first char)
    // line 1 starts at 0, line 2 at 2, line 3 at 4, line 4 at 6
    // anchor=0 → line 1; head=5 → "c" is at offset 4, so lineAt(5) = line 3
    const state = stateWith('a\nb\nc\nd', { anchor: 0, head: 5 });
    expect(resolveCommentRange(state, 1)).toEqual({
      startLine: 1,
      endLine: 3,
      lineContent: 'a\nb\nc',
    });
  });

  it('uses the clicked line when selection is empty', () => {
    const state = stateWith('a\nb\nc');
    expect(resolveCommentRange(state, 2)).toEqual({
      startLine: 2,
      endLine: 2,
      lineContent: 'b',
    });
  });

  it('caps lineContent to empty string when range > 50 lines', () => {
    // Build a 60-line document with lines "L1" … "L60"
    const lines = Array.from({ length: 60 }, (_, i) => `L${i + 1}`);
    const doc = lines.join('\n');
    // Select from first char to last char → all 60 lines
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
    });
    const result = resolveCommentRange(state, 1);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(60);
    expect(result.lineContent).toBe('');
  });

  it('uses exactly 50 lines and includes content (boundary check)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1}`);
    const doc = lines.join('\n');
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
    });
    const result = resolveCommentRange(state, 1);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(50);
    expect(result.lineContent).toBe(doc); // all 50 lines joined
    expect(result.lineContent).not.toBe('');
  });

  it('single-line selection (anchor === head) falls back to clicked line', () => {
    const state = stateWith('foo\nbar\nbaz');
    // Empty selection (cursor only, no range)
    expect(resolveCommentRange(state, 3)).toEqual({
      startLine: 3,
      endLine: 3,
      lineContent: 'baz',
    });
  });

  it('clamps clicked line to valid range when out of bounds', () => {
    const state = stateWith('only');
    expect(resolveCommentRange(state, 99)).toEqual({
      startLine: 1,
      endLine: 1,
      lineContent: 'only',
    });
  });

  it('multi-line selection produces joined content', () => {
    // doc: "alpha\nbeta\ngamma" — lines 1,2,3
    // select from start of "beta" (offset 6) to end of "gamma" (offset 16)
    const doc = 'alpha\nbeta\ngamma';
    const state = EditorState.create({
      doc,
      selection: { anchor: 6, head: 16 },
    });
    expect(resolveCommentRange(state, 1)).toEqual({
      startLine: 2,
      endLine: 3,
      lineContent: 'beta\ngamma',
    });
  });
});
