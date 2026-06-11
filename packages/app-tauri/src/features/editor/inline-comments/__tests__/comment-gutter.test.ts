/**
 * comment-gutter — CM6 extension unit tests.
 *
 * The gutter is a CM6 extension factory; tests verify the StateField that
 * backs comment state tracks adds/deletes correctly without mounting a full
 * EditorView (jsdom can't measure glyphs). The field is the authoritative
 * in-editor state; the gutter marker rendering delegates to CM6 internals
 * tested in CM6's own suite.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  commentField,
  addCommentEffect,
  deleteCommentEffect,
  getCommentsFromState,
  type InlineCommentState,
} from '../comment-gutter';

function makeState(doc: string = 'line1\nline2\nline3\n'): EditorState {
  return EditorState.create({ doc, extensions: [commentField] });
}

describe('commentField StateField', () => {
  it('starts with no comments', () => {
    const state = makeState();
    expect(getCommentsFromState(state)).toHaveLength(0);
  });

  it('addCommentEffect adds a comment at the given line', () => {
    const state = makeState();
    const next = state.update({
      effects: [addCommentEffect.of({ id: 'c1', line: 2, text: '' })],
    }).state;
    const comments = getCommentsFromState(next);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.line).toBe(2);
    expect(comments[0]!.id).toBe('c1');
  });

  it('addCommentEffect accumulates multiple comments', () => {
    const state = makeState();
    const next = state
      .update({ effects: [addCommentEffect.of({ id: 'c1', line: 1, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'c2', line: 3, text: '' })] }).state;
    expect(getCommentsFromState(next)).toHaveLength(2);
  });

  it('deleteCommentEffect removes the matching comment', () => {
    const state = makeState();
    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'c1', line: 2, text: '' })],
    }).state;
    const withDelete = withComment.update({
      effects: [deleteCommentEffect.of('c1')],
    }).state;
    expect(getCommentsFromState(withDelete)).toHaveLength(0);
  });

  it('deleteCommentEffect preserves other comments', () => {
    const state = makeState();
    const withTwo = state
      .update({ effects: [addCommentEffect.of({ id: 'keep', line: 1, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'remove', line: 2, text: '' })] }).state;
    const afterDelete = withTwo.update({
      effects: [deleteCommentEffect.of('remove')],
    }).state;
    const remaining = getCommentsFromState(afterDelete);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('keep');
  });

  it('adding two comments on the same line is allowed', () => {
    const state = makeState();
    const next = state
      .update({ effects: [addCommentEffect.of({ id: 'a', line: 1, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'b', line: 1, text: '' })] }).state;
    expect(getCommentsFromState(next)).toHaveLength(2);
  });

  it('hasCommentOnLine helper returns correct boolean', () => {
    const state = makeState();
    const next = state.update({
      effects: [addCommentEffect.of({ id: 'x', line: 2, text: '' })],
    }).state;
    const comments = getCommentsFromState(next);
    const linesWithComments = new Set(comments.map((c: InlineCommentState) => c.line));
    expect(linesWithComments.has(2)).toBe(true);
    expect(linesWithComments.has(1)).toBe(false);
  });
});
