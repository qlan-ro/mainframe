// @vitest-environment jsdom
/**
 * use-inline-comments — data model unit tests.
 *
 * Tests exercise the pure data model: add, edit, and delete operations.
 * No CM6 EditorView is required; the hook operates entirely on plain line
 * numbers + text.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInlineComments } from '../use-inline-comments';

describe('useInlineComments', () => {
  it('starts with no comments', () => {
    const { result } = renderHook(() => useInlineComments());
    expect(result.current.comments).toHaveLength(0);
  });

  it('addComment adds a comment keyed to the given line', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 5, endLine: 5, lineContent: 'const x = 1;' });
    });

    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0]!.startLine).toBe(5);
    expect(result.current.comments[0]!.endLine).toBe(5);
    expect(result.current.comments[0]!.lineContent).toBe('const x = 1;');
    expect(result.current.comments[0]!.text).toBe('');
  });

  it('addComment assigns a unique id per comment', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 1, endLine: 1, lineContent: 'line1' });
      result.current.addComment({ startLine: 2, endLine: 2, lineContent: 'line2' });
    });

    const ids = result.current.comments.map((c) => c.id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('editComment updates the text of the matching comment', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 3, endLine: 3, lineContent: 'foo' });
    });
    const id = result.current.comments[0]!.id;

    act(() => {
      result.current.editComment(id, 'my note');
    });

    expect(result.current.comments[0]!.text).toBe('my note');
  });

  it('editComment does not affect other comments', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 1, endLine: 1, lineContent: 'a' });
      result.current.addComment({ startLine: 2, endLine: 2, lineContent: 'b' });
    });
    const [first, second] = result.current.comments;

    act(() => {
      result.current.editComment(second!.id, 'note on second');
    });

    expect(result.current.comments.find((c) => c.id === first!.id)!.text).toBe('');
    expect(result.current.comments.find((c) => c.id === second!.id)!.text).toBe('note on second');
  });

  it('deleteComment removes the comment with the given id', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 7, endLine: 8, lineContent: 'multi' });
    });
    const id = result.current.comments[0]!.id;

    act(() => {
      result.current.deleteComment(id);
    });

    expect(result.current.comments).toHaveLength(0);
  });

  it('deleteComment preserves other comments', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 1, endLine: 1, lineContent: 'keep' });
      result.current.addComment({ startLine: 2, endLine: 2, lineContent: 'remove' });
    });
    const [keep, remove] = result.current.comments;

    act(() => {
      result.current.deleteComment(remove!.id);
    });

    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0]!.id).toBe(keep!.id);
  });

  it('hasCommentOnLine returns true when a comment covers that line', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 10, endLine: 12, lineContent: 'range' });
    });

    expect(result.current.hasCommentOnLine(10)).toBe(true);
    expect(result.current.hasCommentOnLine(11)).toBe(true);
    expect(result.current.hasCommentOnLine(12)).toBe(true);
    expect(result.current.hasCommentOnLine(9)).toBe(false);
    expect(result.current.hasCommentOnLine(13)).toBe(false);
  });

  it('getCommentsForLine returns only comments that cover the line', () => {
    const { result } = renderHook(() => useInlineComments());

    act(() => {
      result.current.addComment({ startLine: 5, endLine: 5, lineContent: 'line5' });
      result.current.addComment({ startLine: 10, endLine: 15, lineContent: 'range' });
    });

    expect(result.current.getCommentsForLine(5)).toHaveLength(1);
    expect(result.current.getCommentsForLine(12)).toHaveLength(1);
    expect(result.current.getCommentsForLine(3)).toHaveLength(0);
  });
});
