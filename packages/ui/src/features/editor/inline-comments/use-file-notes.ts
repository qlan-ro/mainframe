/**
 * useFileNotes — the liftable per-tab note model (markdown/CSV/SVG hosts).
 *
 * Wraps useInlineComments (the single canonical note store) and adds a
 * separate draft-text map on top, so a mode toggle (Preview<->Source, table
 * <->Source) can keep in-progress text that the saved note doesn't have yet.
 *
 * useFileTabNotes composes the model with the submit bar and the review
 * actions, giving markdown/CSV/SVG file tabs one hook to own everything above
 * their mode toggle.
 */
import { createElement, useCallback, useState, type ReactNode } from 'react';
import { useInlineComments, type CommentEntry, type AddCommentParams } from './use-inline-comments';
import { useReviewActions } from './use-review-actions';
import { NotesSubmitBar } from './NotesSubmitBar';

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

// ── useFileTabNotes ──────────────────────────────────────────────────────────

export interface UseFileTabNotesOptions {
  /** File path for the review send; when absent, submit is a no-op with a warning. */
  filePath: string | undefined;
}

export interface UseFileTabNotesResult {
  /** The owned note set; pass to CmEditorWithComments' `model` prop for a Source mode. */
  model: UseFileNotesResult;
  /** Convenience bundle of the two props every Source host needs. */
  gutterProps: { model: UseFileNotesResult; filePath: string | undefined };
  /** One NotesSubmitBar for the whole file tab, or null when there are no notes. */
  submitBar: ReactNode;
  /** Count of notes overlapping a source line range (for a block/row's marker). */
  noteCountForLines: (startLine: number, endLine: number) => number;
  /** Marks a note as the one whose widget should be visible on a non-CM surface. */
  openNote: (id: string) => void;
  /** The note id a non-CM surface should currently render its widget for, if any. */
  openNoteId: string | null;
  /** Sends a single note's review comment and removes it from every surface. */
  handleSendOne: (noteId: string) => Promise<void>;
  /** Deletes a note without sending it. */
  removeComment: (noteId: string) => void;
}

/**
 * One hook for the three lifted hosts (MarkdownEditorTab, CsvViewer,
 * SvgViewer) so they share no source file with one another. `openNoteId` is
 * an addition beyond the plan's named return shape: a Preview block or a CSV
 * row has no CM6 widget to open/close, so something has to carry which note's
 * card is currently visible — this hook is the natural owner since it already
 * owns the note set.
 */
export function useFileTabNotes({ filePath }: UseFileTabNotesOptions): UseFileTabNotesResult {
  const model = useFileNotes();
  const { handleSubmitReview, handleSendOne, removeComment } = useReviewActions({ filePath, model });
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  const filledCount = model.notes.filter((note) => {
    const draft = model.drafts[note.id];
    const text = draft !== undefined ? draft : note.text;
    return text.trim().length > 0;
  }).length;

  const submitBar =
    model.notes.length > 0
      ? createElement(NotesSubmitBar, { total: model.notes.length, filled: filledCount, onSubmit: handleSubmitReview })
      : null;

  const noteCountForLines = useCallback(
    (startLine: number, endLine: number) =>
      model.notes.filter((note) => note.startLine <= endLine && note.endLine >= startLine).length,
    [model.notes],
  );

  const openNote = useCallback((id: string) => setOpenNoteId(id), []);

  return {
    model,
    gutterProps: { model, filePath },
    submitBar,
    noteCountForLines,
    openNote,
    openNoteId,
    handleSendOne,
    removeComment,
  };
}
