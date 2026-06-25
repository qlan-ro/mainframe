/**
 * CmEditorWithComments — CmEditor + the comment gutter + React portals.
 *
 * Composes three concerns:
 *   1. useInlineComments — comment data model (add/edit/delete/query)
 *   2. buildCommentGutter — CM6 gutter extension with click-to-add / click-to-open
 *   3. Per-comment portal — rendered into stable host <div>s that CM6 block
 *      widget decorations inject below each commented line.
 *
 * Block widgets (not hand-inserted DOM) are used so CM6 owns widget
 * placement and lifecycle.  The widget's toDOM() returns a stable host element;
 * this component portals InlineCommentWidget into it.  When a widget is
 * removed (deleteCommentEffect) its WidgetType.destroy() fires and the portal
 * is cleaned up.
 *
 * Props extend CmEditorProps (re-adding extraExtensions and onViewReady as
 * passthroughs) with an optional `enableComments` flag (default true).
 * - extraExtensions: merged with the comment-gutter extensions so LSP and the
 *   gutter coexist in one editor (required by A3).
 * - onViewReady: forwarded alongside the internal viewRef assignment so the
 *   parent context-menu can resolve the live EditorView (required by A1/A3).
 *
 * Submit-review bar:
 *   When any comments have non-empty text, a 30px bar appears below the header
 *   (above the editor) with a count and a "Submit review (N)" button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { MessageSquare } from 'lucide-react';
import type { CmEditorProps } from '../CmEditor';
import { CmEditor } from '../CmEditor';
import {
  addCommentEffect,
  deleteCommentEffect,
  buildCommentGutter,
  commentField,
  type CommentBlockWidget,
} from './comment-gutter';
import { useInlineComments } from './use-inline-comments';
import { InlineCommentWidget } from './InlineCommentWidget';

// ── Types ────────────────────────────────────────────────────────────────────

type CmEditorWithCommentsProps = Omit<CmEditorProps, 'extraExtensions' | 'onViewReady'> & {
  enableComments?: boolean;
  /** Additional CM6 extensions merged with the comment-gutter extensions (e.g. LSP). */
  extraExtensions?: Extension[];
  /** Called with the live EditorView once mounted; forwarded to parent for context-menu use. */
  onViewReady?: (view: EditorView) => void;
};

/** Portal descriptor: the comment id + the host element from the block widget. */
interface WidgetPortal {
  commentId: string;
  hostElement: HTMLDivElement;
}

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

// ── Component ────────────────────────────────────────────────────────────────

export function CmEditorWithComments({
  enableComments = true,
  extraExtensions,
  onViewReady,
  ...editorProps
}: CmEditorWithCommentsProps) {
  const viewRef = useRef<EditorView | null>(null);
  const { comments, addComment, editComment, deleteComment } = useInlineComments();

  // Active portals: each entry corresponds to an open (visible) comment widget.
  const [portals, setPortals] = useState<WidgetPortal[]>([]);
  const portalsRef = useRef<WidgetPortal[]>([]);

  // Per-portal draft text state.
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});

  // ── Portal management helpers ────────────────────────────────────────────

  /** Open a portal into the block widget host for `commentId` (if not already open). */
  const openPortalForWidget = useCallback((commentId: string, widget: CommentBlockWidget) => {
    if (portalsRef.current.some((p) => p.commentId === commentId)) return;

    // Register a destroy callback on the widget so we clean up if CM6 removes it.
    widget.setDestroyCallback(() => {
      portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
      setPortals((prev) => prev.filter((p) => p.commentId !== commentId));
    });

    const entry: WidgetPortal = { commentId, hostElement: widget.hostElement };
    portalsRef.current = [...portalsRef.current, entry];
    setPortals((prev) => [...prev, entry]);
  }, []);

  /** Close (unmount) a portal without deleting the comment data. */
  const closePortal = useCallback((commentId: string) => {
    portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
    setPortals((prev) => prev.filter((p) => p.commentId !== commentId));
  }, []);

  // ── Gutter callbacks ─────────────────────────────────────────────────────

  const onAddComment = useCallback(
    (line: number) => {
      const view = viewRef.current;
      if (!view) return;

      const totalLines = view.state.doc.lines;
      const safeLine = Math.max(1, Math.min(line, totalLines));
      const docLine = view.state.doc.line(safeLine);
      const lineContent = docLine.text;

      const id = addComment({ startLine: line, endLine: line, lineContent });

      // Dispatch the CM6 effect so commentField creates the block widget decoration.
      view.dispatch({ effects: [addCommentEffect.of({ id, line, text: '' })] });

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

  // ── Gutter extension (stable reference) ─────────────────────────────────

  const onAddRef = useRef(onAddComment);
  onAddRef.current = onAddComment;
  const onOpenRef = useRef(onOpenComment);
  onOpenRef.current = onOpenComment;

  // Merge caller-provided extensions (e.g. LSP) with the comment gutter so
  // both coexist in one editor. extraExtensions comes first so the gutter
  // appears after other gutters in left-to-right order.
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

  // ── Widget save / delete handlers ────────────────────────────────────────

  const handleSave = useCallback(
    (commentId: string, text: string) => {
      editComment(commentId, text);
      closePortal(commentId);
    },
    [editComment, closePortal],
  );

  const handleDelete = useCallback(
    (commentId: string) => {
      const view = viewRef.current;
      deleteComment(commentId);
      closePortal(commentId);
      if (view) {
        view.dispatch({ effects: [deleteCommentEffect.of(commentId)] });
      }
    },
    [deleteComment, closePortal],
  );

  const handleTextChange = useCallback((commentId: string, text: string) => {
    setDraftTexts((prev) => ({ ...prev, [commentId]: text }));
  }, []);

  // ── Submit review ────────────────────────────────────────────────────────

  // Submit all comments that have non-empty text (marks them as "saved").
  const handleSubmitReview = useCallback(() => {
    for (const comment of comments) {
      const draft = draftTexts[comment.id];
      const effectiveText = draft !== undefined ? draft : comment.text;
      if (effectiveText.trim()) {
        editComment(comment.id, effectiveText);
      }
    }
    // Close all open portals.
    setPortals([]);
    portalsRef.current = [];
    setDraftTexts({});
  }, [comments, draftTexts, editComment]);

  // Count of comments that have any text (draft or saved).
  const filledCount = comments.filter((c) => {
    const draft = draftTexts[c.id];
    const text = draft !== undefined ? draft : c.text;
    return text.trim().length > 0;
  }).length;

  const showSubmitBar = enableComments && comments.length > 0;

  // ── Cleanup portals on unmount ───────────────────────────────────────────

  useEffect(() => {
    return () => {
      portalsRef.current = [];
    };
  }, []);

  // ── View ready callback ──────────────────────────────────────────────────

  // Stable ref so the onViewReady passthrough is always up-to-date without
  // re-creating handleViewReady (which would re-mount the editor).
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;

  const handleViewReady = useCallback((view: EditorView) => {
    viewRef.current = view;
    // Forward to the parent so the EditorContextMenu's viewRef resolves.
    onViewReadyRef.current?.(view);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {showSubmitBar && (
        <SubmitReviewBar count={comments.length} filledCount={filledCount} onSubmit={handleSubmitReview} />
      )}
      <CmEditor {...editorProps} extraExtensions={commentExtensions} onViewReady={handleViewReady} />
      {portals.map((portal) => {
        const comment = comments.find((c) => c.id === portal.commentId);
        const text = draftTexts[portal.commentId] ?? comment?.text ?? '';
        // Derive 1-based line number from the comment's anchor position.
        const lineNumber = comment?.startLine;
        return createPortal(
          <InlineCommentWidget
            key={portal.commentId}
            text={text}
            lineNumber={lineNumber}
            lineContent={comment?.lineContent}
            onTextChange={(t) => handleTextChange(portal.commentId, t)}
            onSave={() => handleSave(portal.commentId, text)}
            onClose={() => closePortal(portal.commentId)}
            onDelete={() => handleDelete(portal.commentId)}
          />,
          portal.hostElement,
        );
      })}
    </>
  );
}
