/**
 * useInlineComments — editor-agnostic comment data model.
 *
 * Decoupled from Monaco and CM6: operates on plain line numbers + text.
 * The CM6 gutter extension (comment-gutter.ts) reads from / writes to this
 * hook's state via callbacks passed down as props.
 *
 * API:
 *   addComment(params)        — open a new comment on the given line range
 *   editComment(id, text)     — update the text of an existing comment
 *   deleteComment(id)         — remove a comment
 *   hasCommentOnLine(line)    — true when any comment covers the line
 *   getCommentsForLine(line)  — all comments whose range includes the line
 */
import { useCallback, useState } from 'react';

export interface CommentEntry {
  id: string;
  startLine: number;
  endLine: number;
  lineContent: string;
  text: string;
}

export interface AddCommentParams {
  startLine: number;
  endLine: number;
  lineContent: string;
}

export interface UseInlineCommentsResult {
  comments: CommentEntry[];
  addComment: (params: AddCommentParams) => string;
  editComment: (id: string, text: string) => void;
  deleteComment: (id: string) => void;
  hasCommentOnLine: (line: number) => boolean;
  getCommentsForLine: (line: number) => CommentEntry[];
}

/**
 * Returns a stable comment store with add/edit/delete operations.
 *
 * The returned functions are stable across renders (useCallback with no
 * changing deps). Callers that need to open the CM6 block widget pass
 * addComment's return value (the new id) into the gutter dispatch.
 */
export function useInlineComments(): UseInlineCommentsResult {
  const [comments, setComments] = useState<CommentEntry[]>([]);

  const addComment = useCallback((params: AddCommentParams): string => {
    const id = `comment-${crypto.randomUUID()}`;
    const entry: CommentEntry = { id, text: '', ...params };
    setComments((prev) => [...prev, entry]);
    return id;
  }, []);

  const editComment = useCallback((id: string, text: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  const deleteComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const hasCommentOnLine = useCallback(
    (line: number): boolean => comments.some((c) => line >= c.startLine && line <= c.endLine),
    [comments],
  );

  const getCommentsForLine = useCallback(
    (line: number): CommentEntry[] => comments.filter((c) => line >= c.startLine && line <= c.endLine),
    [comments],
  );

  return { comments, addComment, editComment, deleteComment, hasCommentOnLine, getCommentsForLine };
}
