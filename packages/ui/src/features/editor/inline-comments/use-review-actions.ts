/**
 * useReviewActions — submit-review + per-comment-send callbacks for CmEditorWithComments.
 *
 * Extracted to keep CmEditorWithComments under the 300-line limit.
 * Owns: buildItem, removeComment, handleSubmitReview, handleSendOne.
 */
import { useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import type { CommentEntry } from './use-inline-comments';
import { deleteCommentEffect } from './comment-gutter';
import { useSendReview } from './use-send-review';
import type { LineCommentInput } from '@/lib/editor/format-line-comment';

interface UseReviewActionsParams {
  filePath: string | undefined;
  comments: CommentEntry[];
  draftTexts: Record<string, string>;
  deleteComment: (id: string) => void;
  setPortals: React.Dispatch<React.SetStateAction<{ commentId: string; hostElement: HTMLDivElement }[]>>;
  portalsRef: React.MutableRefObject<{ commentId: string; hostElement: HTMLDivElement }[]>;
  setDraftTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  viewRef: React.MutableRefObject<EditorView | null>;
}

export interface ReviewActions {
  handleSubmitReview: () => void;
  handleSendOne: (commentId: string) => void;
  removeComment: (commentId: string) => void;
}

export function useReviewActions({
  filePath,
  comments,
  draftTexts,
  deleteComment,
  setPortals,
  portalsRef,
  setDraftTexts,
  viewRef,
}: UseReviewActionsParams): ReviewActions {
  const sendReview = useSendReview();

  const buildItem = useCallback(
    (c: CommentEntry): LineCommentInput | null => {
      const draft = draftTexts[c.id];
      const comment = draft !== undefined ? draft : c.text;
      if (!comment.trim()) return null;
      return { startLine: c.startLine, endLine: c.endLine, lineContent: c.lineContent, comment };
    },
    [draftTexts],
  );

  const removeComment = useCallback(
    (commentId: string) => {
      const view = viewRef.current;
      deleteComment(commentId);
      if (view) {
        view.dispatch({ effects: [deleteCommentEffect.of(commentId)] });
      }
      portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
      setPortals((prev) => prev.filter((p) => p.commentId !== commentId));
    },
    [deleteComment, viewRef, portalsRef, setPortals],
  );

  const handleSubmitReview = useCallback(() => {
    if (!filePath) {
      console.warn('[editor] no file path, skipping review send');
      return;
    }
    const items = comments.map(buildItem).filter((x): x is LineCommentInput => x !== null);
    void sendReview(filePath, items);
    for (const c of comments) {
      removeComment(c.id);
    }
    setDraftTexts({});
  }, [filePath, comments, buildItem, sendReview, removeComment, setDraftTexts]);

  const handleSendOne = useCallback(
    (commentId: string) => {
      if (!filePath) {
        console.warn('[editor] no file path, skipping review send');
        return;
      }
      const c = comments.find((x) => x.id === commentId);
      if (!c) return;
      const item = buildItem(c);
      if (!item) return;
      void sendReview(filePath, [item]);
      removeComment(commentId);
      setDraftTexts((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    },
    [filePath, comments, buildItem, sendReview, removeComment, setDraftTexts],
  );

  return { handleSubmitReview, handleSendOne, removeComment };
}
