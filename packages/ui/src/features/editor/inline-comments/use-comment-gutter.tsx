/**
 * useCommentGutter — editor-agnostic inline-comment orchestration.
 *
 * Owns the whole comment concern independent of WHICH CodeMirror view hosts it:
 *   1. useInlineComments — comment data model (add/edit/delete/query)
 *   2. buildCommentGutter — CM6 gutter extension with click-to-add / click-to-open
 *   3. Per-comment portal — rendered into stable host <div>s that CM6 block
 *      widget decorations inject below each commented line.
 *
 * The consumer wires the returned `commentExtensions` into a view (the code
 * editor's compartment, or the diff editor's modified pane) and forwards
 * `handleViewReady` so the gutter callbacks can resolve the live EditorView. It
 * then renders `submitBar` above the view and `portals` alongside it. This lets
 * both CmEditorWithComments and CmDiffEditorWithComments share one implementation.
 */
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { addCommentEffect, buildCommentGutter, commentField } from './comment-gutter';
import { useFileNotes, type UseFileNotesResult } from './use-file-notes';
import { InlineCommentWidget } from './InlineCommentWidget';
import { resolveCommentRange } from './resolve-comment-range';
import { useReviewActions } from './use-review-actions';
import { useCommentPortals } from './use-comment-portals';
import { SubmitReviewBar } from './SubmitReviewBar';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UseCommentGutterOptions {
  /** When false, no gutter is installed and no submit bar renders. Default true. */
  enableComments?: boolean;
  /** Additional CM6 extensions merged BEFORE the comment gutter (e.g. LSP). */
  extraExtensions?: Extension[];
  /** Forwarded to the parent once the hosting EditorView mounts. */
  onViewReady?: (view: EditorView) => void;
  /** File path for the review send; when absent, submit is a no-op with a warning. */
  filePath?: string;
  /**
   * A note set owned above this view (markdown/CSV/SVG lifted hosts). When
   * provided, this hook seeds/reconciles the CM gutter from it instead of
   * creating its own, and renders no submit bar — the lifted host renders its
   * own NotesSubmitBar once for the whole file tab.
   */
  model?: UseFileNotesResult;
}

export interface UseCommentGutterResult {
  /** Extensions to install on the hosting view (LSP + comment gutter). */
  commentExtensions: Extension[];
  /** Pass to the host view's `onViewReady` so gutter callbacks resolve the view. */
  handleViewReady: (view: EditorView) => void;
  /** The "Submit review" bar (or null when there are no comments). */
  submitBar: ReactNode;
  /** The open per-comment widget portals. */
  portals: ReactNode;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCommentGutter({
  enableComments = true,
  extraExtensions,
  onViewReady,
  filePath,
  model: injectedModel,
}: UseCommentGutterOptions): UseCommentGutterResult {
  const viewRef = useRef<EditorView | null>(null);
  // Always call our own model (never conditionally) so this hook's shape stays
  // stable across renders; injectedModel ?? ownModel picks which one is live.
  const ownModel = useFileNotes();
  const model = injectedModel ?? ownModel;
  const { notes: comments, addNote: addComment, editNote: editComment, drafts: draftTexts, setDraft } = model;

  const { portalEntries, openPortalForWidget, closePortal } = useCommentPortals();

  const { handleSubmitReview, handleSendOne, removeComment } = useReviewActions({
    filePath,
    model,
    viewRef,
    closePortal,
  });

  // ── Gutter callbacks ───────────────────────────────────────────────────────

  const onAddComment = useCallback(
    (line: number) => {
      const view = viewRef.current;
      if (!view) return;

      // When there is an active selection the comment captures the full range;
      // otherwise only the clicked line is used.
      const { startLine, endLine, lineContent } = resolveCommentRange(view.state, line);

      const id = addComment({ startLine, endLine, lineContent });

      // Anchor the block widget BELOW endLine so it appears after the last
      // selected line (not after the first).
      view.dispatch({ effects: [addCommentEffect.of({ id, line: endLine, text: '' })] });

      // Open the portal using the widget that was just created.
      const widget = view.state.field(commentField).widgets.get(id);
      if (widget) {
        openPortalForWidget(id, widget);
      }
    },
    [addComment, openPortalForWidget],
  );

  const onOpenComment = useCallback(
    (id: string) => {
      const view = viewRef.current;
      if (!view) return;
      const widget = view.state.field(commentField).widgets.get(id);
      if (widget) {
        openPortalForWidget(id, widget);
      }
    },
    [openPortalForWidget],
  );

  // ── Gutter extension (stable reference) ────────────────────────────────────

  const onAddRef = useRef(onAddComment);
  onAddRef.current = onAddComment;
  const onOpenRef = useRef(onOpenComment);
  onOpenRef.current = onOpenComment;

  // Merge caller-provided extensions (e.g. LSP) with the comment gutter so both
  // coexist in one view. extraExtensions comes first so the gutter appears after
  // other gutters in left-to-right order.
  const commentExtensions = useMemo<Extension[]>(() => {
    const gutterExt = enableComments
      ? [
          buildCommentGutter({
            onAddComment: (line) => onAddRef.current(line),
            onOpenComment: (id) => onOpenRef.current(id),
          }),
        ]
      : [];
    return [...(extraExtensions ?? []), ...gutterExt];
  }, [enableComments, extraExtensions]);

  // ── Widget save / delete handlers ──────────────────────────────────────────

  const handleSave = useCallback(
    (commentId: string, text: string) => {
      editComment(commentId, text);
      closePortal(commentId);
    },
    [editComment, closePortal],
  );

  const handleTextChange = useCallback(
    (commentId: string, text: string) => {
      setDraft(commentId, text);
    },
    [setDraft],
  );

  // Count of comments that have any text (draft or saved).
  const filledCount = comments.filter((c) => {
    const draft = draftTexts[c.id];
    const text = draft !== undefined ? draft : c.text;
    return text.trim().length > 0;
  }).length;

  // A lifted host owns its own NotesSubmitBar for the whole file tab; this
  // hook's bar is only for the code/diff editor's own (uninjected) model.
  const showSubmitBar = !injectedModel && enableComments && comments.length > 0;

  // ── View ready callback ────────────────────────────────────────────────────

  // Stable ref so the onViewReady passthrough is always up-to-date without
  // re-creating handleViewReady (which would re-mount the editor).
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;

  const handleViewReady = useCallback((view: EditorView) => {
    viewRef.current = view;
    // Forward to the parent so an EditorContextMenu's viewRef resolves.
    onViewReadyRef.current?.(view);
  }, []);

  const submitBar = showSubmitBar ? (
    <SubmitReviewBar count={comments.length} filledCount={filledCount} onSubmit={handleSubmitReview} />
  ) : null;

  const portals = (
    <>
      {portalEntries.map((portal) => {
        const comment = comments.find((c) => c.id === portal.commentId);
        const text = draftTexts[portal.commentId] ?? comment?.text ?? '';
        return createPortal(
          <InlineCommentWidget
            key={portal.commentId}
            text={text}
            lineNumber={comment?.startLine}
            endLine={comment?.endLine}
            lineContent={comment?.lineContent}
            onTextChange={(t) => handleTextChange(portal.commentId, t)}
            onSave={() => handleSave(portal.commentId, text)}
            onClose={() => closePortal(portal.commentId)}
            onDelete={() => removeComment(portal.commentId)}
            onSend={() => handleSendOne(portal.commentId)}
          />,
          portal.hostElement,
        );
      })}
    </>
  );

  return { commentExtensions, handleViewReady, submitBar, portals };
}
