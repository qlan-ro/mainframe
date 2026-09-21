/**
 * useReviewActions — submit-review + per-comment-send callbacks.
 *
 * Model-shaped so both useCommentGutter (a CM view + portals to tear down)
 * and the lifted useFileTabNotes hosts (a table row or a rendered block —
 * no view, no portal) can share one implementation.
 */
import { useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import type { FileNote } from './use-file-notes';
import { deleteCommentEffect } from './comment-gutter';
import { useSendReview } from './use-send-review';
import type { LineCommentInput } from '@/lib/editor/format-line-comment';

interface ReviewActionsModel {
  notes: FileNote[];
  drafts: Record<string, string>;
  deleteNote: (id: string) => void;
}

interface UseReviewActionsParams {
  filePath: string | undefined;
  model: ReviewActionsModel;
  /** CM view to dispatch a delete effect on; absent for row/block hosts with no view. */
  viewRef?: React.RefObject<EditorView | null>;
  /** Closes an open widget portal for the given note id; absent for row/block hosts. */
  closePortal?: (id: string) => void;
}

export interface ReviewActions {
  handleSubmitReview: () => Promise<void>;
  handleSendOne: (noteId: string) => Promise<void>;
  removeComment: (noteId: string) => void;
}

export function useReviewActions({ filePath, model, viewRef, closePortal }: UseReviewActionsParams): ReviewActions {
  const sendReview = useSendReview();

  const buildItem = useCallback(
    (note: FileNote): LineCommentInput | null => {
      const draft = model.drafts[note.id];
      const comment = draft !== undefined ? draft : note.text;
      if (!comment.trim()) return null;
      return { startLine: note.startLine, endLine: note.endLine, lineContent: note.lineContent, comment };
    },
    [model.drafts],
  );

  const removeComment = useCallback(
    (noteId: string) => {
      const view = viewRef?.current;
      model.deleteNote(noteId);
      if (view) {
        view.dispatch({ effects: [deleteCommentEffect.of(noteId)] });
      }
      closePortal?.(noteId);
    },
    [model, viewRef, closePortal],
  );

  const handleSubmitReview = useCallback(async () => {
    if (!filePath) {
      console.warn('[editor] no file path, skipping review send');
      return;
    }
    const items = model.notes
      .map(buildItem)
      .filter((x): x is LineCommentInput => x !== null)
      .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    if (items.length === 0) return;

    let outcome;
    try {
      outcome = await sendReview(filePath, items);
    } catch (err) {
      console.warn('[editor] review send failed', err);
    }
    // A skipped send (no active session) must leave every note and draft in place.
    if (outcome === 'no-session') return;

    for (const note of model.notes) {
      removeComment(note.id);
    }
  }, [filePath, model.notes, buildItem, sendReview, removeComment]);

  const handleSendOne = useCallback(
    async (noteId: string) => {
      if (!filePath) {
        console.warn('[editor] no file path, skipping review send');
        return;
      }
      const note = model.notes.find((n) => n.id === noteId);
      if (!note) return;
      const item = buildItem(note);
      if (!item) return;

      let outcome;
      try {
        outcome = await sendReview(filePath, [item]);
      } catch (err) {
        console.warn('[editor] review send failed', err);
      }
      if (outcome === 'no-session') return;

      removeComment(noteId);
    },
    [filePath, model.notes, buildItem, sendReview, removeComment],
  );

  return { handleSubmitReview, handleSendOne, removeComment };
}
