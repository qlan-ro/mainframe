/**
 * useFileNotes — the liftable per-tab note model (markdown/CSV/SVG hosts).
 *
 * Wraps useInlineComments (the single canonical note store) and adds a
 * separate draft-text map on top, so a mode toggle (Preview<->Source, table
 * <->Source) can keep in-progress text that the saved note doesn't have yet.
 */
import { useCallback, useState } from 'react';
import { useInlineComments, type CommentEntry, type AddCommentParams } from './use-inline-comments';

export type FileNote = CommentEntry;
export type AddNoteParams = AddCommentParams;

export interface UseFileNotesResult {
  notes: FileNote[];
  drafts: Record<string, string>;
  addNote: (params: AddNoteParams) => string;
  editNote: (id: string, text: string) => void;
  deleteNote: (id: string) => void;
  setDraft: (id: string, text: string) => void;
  setNoteRange: (id: string, startLine: number, endLine: number) => void;
  clearAll: () => void;
  getNotesForLine: (line: number) => FileNote[];
  hasNoteOnLine: (line: number) => boolean;
}

export function useFileNotes(): UseFileNotesResult {
  const {
    comments: notes,
    addComment: addNote,
    editComment: editNote,
    deleteComment,
    hasCommentOnLine: hasNoteOnLine,
    getCommentsForLine: getNotesForLine,
    setCommentRange: setNoteRange,
  } = useInlineComments();

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const clearDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const deleteNote = useCallback(
    (id: string) => {
      deleteComment(id);
      clearDraft(id);
    },
    [deleteComment, clearDraft],
  );

  const setDraft = useCallback((id: string, text: string) => {
    setDrafts((prev) => ({ ...prev, [id]: text }));
  }, []);

  const clearAll = useCallback(() => {
    for (const note of notes) deleteComment(note.id);
    setDrafts({});
  }, [notes, deleteComment]);

  return {
    notes,
    drafts,
    addNote,
    editNote,
    deleteNote,
    setDraft,
    setNoteRange,
    clearAll,
    getNotesForLine,
    hasNoteOnLine,
  };
}
