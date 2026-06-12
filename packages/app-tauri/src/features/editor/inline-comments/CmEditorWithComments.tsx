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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
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
      <CmEditor {...editorProps} extraExtensions={commentExtensions} onViewReady={handleViewReady} />
      {portals.map((portal) => {
        const comment = comments.find((c) => c.id === portal.commentId);
        const text = draftTexts[portal.commentId] ?? comment?.text ?? '';
        return createPortal(
          <InlineCommentWidget
            key={portal.commentId}
            text={text}
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
