// @vitest-environment jsdom
/**
 * useFileNotes — the liftable per-tab note model (markdown/CSV/SVG hosts).
 *
 * Mirrors useInlineComments' add/edit/delete + line-query contract, adding a
 * separate draft store and a range write-back (setNoteRange) that the CM
 * view-sync hook uses to keep a note's marker following document edits
 * without losing the quote it captured on creation.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileNotes } from '../use-file-notes';

describe('useFileNotes', () => {
  it('starts with no notes and no drafts', () => {
    const { result } = renderHook(() => useFileNotes());
    expect(result.current.notes).toHaveLength(0);
    expect(result.current.drafts).toEqual({});
  });

  it('addNote adds a note keyed to the given range', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 4, endLine: 6, lineContent: '## Heading\ntext' });
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]).toMatchObject({
      startLine: 4,
      endLine: 6,
      lineContent: '## Heading\ntext',
      text: '',
    });
  });

  it('editNote updates the saved text of the matching note', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 1, endLine: 1, lineContent: 'a' });
    });
    const id = result.current.notes[0]!.id;

    act(() => {
      result.current.editNote(id, 'looks good');
    });

    expect(result.current.notes[0]!.text).toBe('looks good');
  });

  it('deleteNote removes the note with the given id', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 2, endLine: 2, lineContent: 'b' });
    });
    const id = result.current.notes[0]!.id;

    act(() => {
      result.current.deleteNote(id);
    });

    expect(result.current.notes).toHaveLength(0);
  });

  it('setDraft records unsaved text readable back from drafts, without touching the saved text', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 1, endLine: 1, lineContent: 'a' });
    });
    const id = result.current.notes[0]!.id;

    act(() => {
      result.current.setDraft(id, 'still typing…');
    });

    expect(result.current.drafts[id]).toBe('still typing…');
    expect(result.current.notes[0]!.text).toBe('');
  });

  it("setNoteRange moves a note's recorded range and leaves its captured quote alone", () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 5, endLine: 5, lineContent: 'const x = 1;' });
    });
    const id = result.current.notes[0]!.id;

    act(() => {
      result.current.setNoteRange(id, 7, 7);
    });

    expect(result.current.notes[0]).toMatchObject({ startLine: 7, endLine: 7, lineContent: 'const x = 1;' });
  });

  it('clearAll empties both notes and drafts', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 1, endLine: 1, lineContent: 'a' });
      result.current.addNote({ startLine: 2, endLine: 2, lineContent: 'b' });
    });
    const [first, second] = result.current.notes;
    act(() => {
      result.current.setDraft(first!.id, 'draft one');
      result.current.setDraft(second!.id, 'draft two');
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notes).toHaveLength(0);
    expect(result.current.drafts).toEqual({});
  });

  it('getNotesForLine returns only notes whose range covers the line', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 5, endLine: 5, lineContent: 'line5' });
      result.current.addNote({ startLine: 10, endLine: 15, lineContent: 'range' });
    });

    expect(result.current.getNotesForLine(5)).toHaveLength(1);
    expect(result.current.getNotesForLine(12)).toHaveLength(1);
    expect(result.current.getNotesForLine(3)).toHaveLength(0);
  });

  it('hasNoteOnLine reports coverage without needing the full note list', () => {
    const { result } = renderHook(() => useFileNotes());

    act(() => {
      result.current.addNote({ startLine: 10, endLine: 12, lineContent: 'range' });
    });

    expect(result.current.hasNoteOnLine(11)).toBe(true);
    expect(result.current.hasNoteOnLine(13)).toBe(false);
  });
});
