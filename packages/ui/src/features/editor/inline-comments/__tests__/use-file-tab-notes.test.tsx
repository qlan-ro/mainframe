// @vitest-environment jsdom
/**
 * useFileTabNotes — the composition hook for the three lifted hosts.
 *
 * The plan names five return keys (model, gutterProps, submitBar,
 * noteCountForLines, openNote); this also returns openNoteId, since a
 * Preview block or CSV row has no CM6 widget to track its own open/closed
 * state and something has to carry it (see use-file-notes.ts's doc comment).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { useFileTabNotes } from '../use-file-notes';

const mockSendReview = vi.fn().mockResolvedValue('sent');
vi.mock('../use-send-review', () => ({
  useSendReview: () => mockSendReview,
}));

describe('useFileTabNotes', () => {
  it('has no submit bar when there are no notes', () => {
    const { result } = renderHook(() => useFileTabNotes({ filePath: 'a.md' }));
    expect(result.current.submitBar).toBeNull();
  });

  it('gutterProps bundles the same model instance and the given filePath', () => {
    const { result } = renderHook(() => useFileTabNotes({ filePath: 'a.md' }));
    expect(result.current.gutterProps.model).toBe(result.current.model);
    expect(result.current.gutterProps.filePath).toBe('a.md');
  });

  it('noteCountForLines counts notes overlapping the given range', () => {
    const { result } = renderHook(() => useFileTabNotes({ filePath: 'a.md' }));

    act(() => {
      result.current.model.addNote({ startLine: 3, endLine: 5, lineContent: 'block' });
    });

    expect(result.current.noteCountForLines(1, 2)).toBe(0);
    expect(result.current.noteCountForLines(4, 4)).toBe(1);
    expect(result.current.noteCountForLines(5, 10)).toBe(1);
  });

  it('openNote records the given id as openNoteId', () => {
    const { result } = renderHook(() => useFileTabNotes({ filePath: 'a.md' }));

    act(() => {
      result.current.openNote('note-1');
    });

    expect(result.current.openNoteId).toBe('note-1');
  });

  it('renders a submit bar reflecting the owned note set once notes exist', () => {
    const { result } = renderHook(() => useFileTabNotes({ filePath: 'a.md' }));

    act(() => {
      result.current.model.addNote({ startLine: 1, endLine: 1, lineContent: 'x' });
    });

    render(<>{result.current.submitBar}</>);
    expect(screen.getByTestId('editor-submit-review')).toHaveTextContent('0 of 1 agent note filled');
  });

  it('submitting sends and clears through the shared review-actions path', async () => {
    const { result } = renderHook(() => useFileTabNotes({ filePath: 'a.md' }));

    act(() => {
      result.current.model.addNote({ startLine: 1, endLine: 1, lineContent: 'x' });
    });
    act(() => {
      result.current.model.editNote(result.current.model.notes[0]!.id, 'looks good');
    });

    render(<>{result.current.submitBar}</>);
    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockSendReview).toHaveBeenCalledWith('a.md', [
      { startLine: 1, endLine: 1, lineContent: 'x', comment: 'looks good' },
    ]);
  });
});
