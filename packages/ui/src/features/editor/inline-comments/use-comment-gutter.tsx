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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { MessageSquare } from 'lucide-react';
import { addCommentEffect, buildCommentGutter, commentField, type CommentBlockWidget } from './comment-gutter';
import { useInlineComments } from './use-inline-comments';
import { InlineCommentWidget } from './InlineCommentWidget';
import { resolveCommentRange } from './resolve-comment-range';
import { useReviewActions } from './use-review-actions';

// ── SubmitReviewBar ──────────────────────────────────────────────────────────

interface SubmitReviewBarProps {
  count: number;
  filledCount: number;
  onSubmit: () => void;
}

function SubmitReviewBar({ count, filledCount, onSubmit }: SubmitReviewBarProps) {
  return (
    <div
      data-testid="editor-submit-review"
      className="flex h-[30px] shrink-0 items-center gap-2 bg-mf-content2 px-3 [border-bottom:0.5px_solid_var(--border)]"
    >
      <MessageSquare size={11} className="shrink-0 text-primary" aria-hidden />
      <span className="text-caption text-muted-foreground">
        {count} agent {count === 1 ? 'note' : 'notes'}
      </span>
      <div className="flex-1" />
      <button
        data-testid="editor-submit-review-btn"
        type="button"
        onClick={onSubmit}
        disabled={filledCount === 0}
        className="inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border-none bg-primary/10 px-[9px] text-caption font-semibold text-primary disabled:cursor-default disabled:opacity-40 transition-opacity"
      >
        Submit review ({count})
      </button>
    </div>
  );
}

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

/** Portal descriptor: the comment id + the host element from the block widget. */
interface WidgetPortal {
  commentId: string;
  hostElement: HTMLDivElement;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCommentGutter({
  enableComments = true,
  extraExtensions,
  onViewReady,
  filePath,
}: UseCommentGutterOptions): UseCommentGutterResult {
  const viewRef = useRef<EditorView | null>(null);
  const { comments, addComment, editComment, deleteComment } = useInlineComments();

  // Active portals: each entry corresponds to an open (visible) comment widget.
  const [portalEntries, setPortalEntries] = useState<WidgetPortal[]>([]);
  const portalsRef = useRef<WidgetPortal[]>([]);

  // Per-portal draft text state.
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});

  const { handleSubmitReview, handleSendOne, removeComment } = useReviewActions({
    filePath,
    comments,
    draftTexts,
    deleteComment,
    setPortals: setPortalEntries,
    portalsRef,
    setDraftTexts,
    viewRef,
  });

  // ── Portal management helpers ──────────────────────────────────────────────

  /** Open a portal into the block widget host for `commentId` (if not already open). */
  const openPortalForWidget = useCallback((commentId: string, widget: CommentBlockWidget) => {
    if (portalsRef.current.some((p) => p.commentId === commentId)) return;

    // Register a destroy callback on the widget so we clean up if CM6 removes it.
    widget.setDestroyCallback(() => {
      portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
      setPortalEntries((prev) => prev.filter((p) => p.commentId !== commentId));
    });

    const entry: WidgetPortal = { commentId, hostElement: widget.hostElement };
    portalsRef.current = [...portalsRef.current, entry];
    setPortalEntries((prev) => [...prev, entry]);
  }, []);

  /** Close (unmount) a portal without deleting the comment data. */
  const closePortal = useCallback((commentId: string) => {
    portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
    setPortalEntries((prev) => prev.filter((p) => p.commentId !== commentId));
  }, []);

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

  const handleTextChange = useCallback((commentId: string, text: string) => {
    setDraftTexts((prev) => ({ ...prev, [commentId]: text }));
  }, []);

  // Count of comments that have any text (draft or saved).
  const filledCount = comments.filter((c) => {
    const draft = draftTexts[c.id];
    const text = draft !== undefined ? draft : c.text;
    return text.trim().length > 0;
  }).length;

  const showSubmitBar = enableComments && comments.length > 0;

  // ── Cleanup portals on unmount ─────────────────────────────────────────────

  useEffect(() => {
    return () => {
      portalsRef.current = [];
    };
  }, []);

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
