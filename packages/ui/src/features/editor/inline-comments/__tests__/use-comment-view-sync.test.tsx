// @vitest-environment jsdom
/**
 * useCommentViewSync — model<->view reconciliation (task 8).
 *
 * Mounts a real CmEditorWithComments (not a stub) with an injected model that
 * a "Harness" component owns across a simulated mode toggle, mirroring how
 * MarkdownEditorTab/CsvViewer/SvgViewer will own one note set across
 * Preview<->Source. Same jsdom CM6 stubs as CmEditor.test.tsx (jsdom has no
 * Range.getClientRects, which CM6 calls on mount).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { CmEditorWithComments } from '../CmEditorWithComments';
import { useFileNotes, type UseFileNotesResult } from '../use-file-notes';

const zeroRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

function zeroRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
      /* jsdom stub */
    },
  } as unknown as DOMRectList;
}

beforeAll(() => {
  Range.prototype.getClientRects = zeroRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
});

vi.mock('../use-send-review', () => ({
  useSendReview: () => vi.fn().mockResolvedValue('sent'),
}));

const DOC = 'line1\nline2\nline3\n';

function Harness({ mountEditor, onModel }: { mountEditor: boolean; onModel: (model: UseFileNotesResult) => void }) {
  const model = useFileNotes();
  onModel(model);
  if (!mountEditor) return null;
  return (
    <CmEditorWithComments
      value={DOC}
      language="plaintext"
      readOnly={false}
      path="test.md"
      filePath="test.md"
      onChange={() => {}}
      model={model}
    />
  );
}

describe('useCommentViewSync', () => {
  it('shows a gutter marker for a note already in the model when the view mounts, without any user gesture', () => {
    let model: UseFileNotesResult | undefined;
    const { rerender, container } = render(<Harness mountEditor={false} onModel={(m) => (model = m)} />);

    act(() => {
      model!.addNote({ startLine: 2, endLine: 2, lineContent: 'line2' });
    });
    rerender(<Harness mountEditor={true} onModel={(m) => (model = m)} />);

    expect(container.querySelector('.cm-comment-gutter-marker')).toBeTruthy();
  });

  it('loses its marker when a note is removed from the model outside the view, without a remount', () => {
    let model: UseFileNotesResult | undefined;
    const { rerender, container } = render(<Harness mountEditor={false} onModel={(m) => (model = m)} />);

    let noteId = '';
    act(() => {
      noteId = model!.addNote({ startLine: 1, endLine: 1, lineContent: 'line1' });
    });
    rerender(<Harness mountEditor={true} onModel={(m) => (model = m)} />);
    expect(container.querySelector('.cm-comment-gutter-marker')).toBeTruthy();

    act(() => {
      model!.deleteNote(noteId);
    });
    // Same rerender (same component instance) -- the CM view is never unmounted.
    rerender(<Harness mountEditor={true} onModel={(m) => (model = m)} />);

    expect(container.querySelector('.cm-comment-gutter-marker')).toBeNull();
  });
});
