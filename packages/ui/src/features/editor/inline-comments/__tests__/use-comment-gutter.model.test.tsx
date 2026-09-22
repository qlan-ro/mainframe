// @vitest-environment jsdom
/**
 * useCommentGutter — injected-model bar ownership (task 9).
 *
 * A lifted host (markdown/CSV/SVG) owns one NotesSubmitBar for the whole file
 * tab, so this hook must render none of its own when a model is injected —
 * only the uninjected code/diff editor path (covered by
 * CmEditorWithComments.test.tsx) keeps rendering its own bar.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommentGutter } from '../use-comment-gutter';
import { useFileNotes } from '../use-file-notes';

vi.mock('../use-send-review', () => ({
  useSendReview: () => vi.fn().mockResolvedValue('sent'),
}));

describe('useCommentGutter — bar ownership', () => {
  it('renders no submit bar when a model is injected, even with notes present', () => {
    const { result } = renderHook(() => {
      const model = useFileNotes();
      const gutter = useCommentGutter({ filePath: 'src/foo.md', model });
      return { model, gutter };
    });

    act(() => {
      result.current.model.addNote({ startLine: 1, endLine: 1, lineContent: 'a line' });
    });

    expect(result.current.gutter.submitBar).toBeNull();
  });
});

// The "no model injected -> the hook renders its own bar" half of this
// decision is exercised end to end by CmEditorWithComments.test.tsx, which
// asserts on `editor-submit-review-btn` with a non-empty comment set and
// must keep passing unedited (spec AC 25).
