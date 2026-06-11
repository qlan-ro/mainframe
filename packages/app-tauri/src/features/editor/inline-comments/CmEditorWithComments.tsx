/**
 * CmEditorWithComments — CmEditor + the comment gutter + React portals.
 *
 * Composes three concerns:
 *   1. useInlineComments — comment data model (add/edit/delete/query)
 *   2. buildCommentGutter — CM6 gutter extension with click-to-add / click-to-open
 *   3. Per-comment portal — a DOM node injected after each commented line,
 *      hosting <InlineCommentWidget> via createPortal.
 *
 * The portal host DOM nodes are created imperatively and appended after the
 * CM6 line element using a MutationObserver that watches the scroller for
 * inserted lines. This mirrors the pattern desktop used for Monaco view-zones.
 *
 * Props extend CmEditorProps (minus extraExtensions/onViewReady which are
 * managed here) with an optional `enableComments` flag (default true).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { CmEditorProps } from '../CmEditor';
import { CmEditor } from '../CmEditor';
import { addCommentEffect, deleteCommentEffect, buildCommentGutter } from './comment-gutter';
import { useInlineComments } from './use-inline-comments';
import { InlineCommentWidget } from './InlineCommentWidget';

// ── Types ────────────────────────────────────────────────────────────────────

type CmEditorWithCommentsProps = Omit<CmEditorProps, 'extraExtensions' | 'onViewReady'> & {
  enableComments?: boolean;
};

/** Per-open-widget portal descriptor. */
interface WidgetPortal {
  commentId: string;
  domNode: HTMLDivElement;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CmEditorWithComments({ enableComments = true, ...editorProps }: CmEditorWithCommentsProps) {
  const viewRef = useRef<EditorView | null>(null);
  const { comments, addComment, editComment, deleteComment } = useInlineComments();
  const [portals, setPortals] = useState<WidgetPortal[]>([]);

  // ── Open widget ──────────────────────────────────────────────────────────

  const openWidgetForComment = useCallback((commentId: string, line: number) => {
    const view = viewRef.current;
    if (!view) return;

    // Bail if a portal already exists for this comment.
    setPortals((prev) => {
      if (prev.some((p) => p.commentId === commentId)) return prev;

      // Find the CM6 line DOM element for the given line number.
      const docLine = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      const lineBlock = view.lineBlockAt(docLine.from);
      const lineEl = view.domAtPos(lineBlock.from).node.parentElement;

      if (!lineEl) {
        console.warn('[CmEditorWithComments] could not locate line DOM node for line', line);
        return prev;
      }

      const host = document.createElement('div');
      host.className = 'cm-comment-widget-host';
      host.style.width = '100%';
      lineEl.after(host);

      return [...prev, { commentId, domNode: host }];
    });
  }, []);

  // ── Gutter callbacks ─────────────────────────────────────────────────────

  const onAddComment = useCallback(
    (line: number) => {
      const view = viewRef.current;
      if (!view) return;

      // Read line content from the CM6 doc.
      const docLine = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      const lineContent = docLine.text;

      const id = addComment({ startLine: line, endLine: line, lineContent });

      // Sync into CM6 state so the gutter marker appears.
      view.dispatch({ effects: [addCommentEffect.of({ id, line, text: '' })] });

      openWidgetForComment(id, line);
    },
    [addComment, openWidgetForComment],
  );

  const onOpenComment = useCallback(
    (id: string) => {
      const comment = comments.find((c) => c.id === id);
      if (!comment) return;
      openWidgetForComment(id, comment.startLine);
    },
    [comments, openWidgetForComment],
  );

  // ── Gutter extension (stable reference) ─────────────────────────────────

  // Wrap callbacks in refs so the memoized extension doesn't stale-close.
  const onAddRef = useRef(onAddComment);
  onAddRef.current = onAddComment;
  const onOpenRef = useRef(onOpenComment);
  onOpenRef.current = onOpenComment;

  const commentExtensions = useMemo<Extension[]>(() => {
    if (!enableComments) return [];
    return [
      buildCommentGutter({
        onAddComment: (line) => onAddRef.current(line),
        onOpenComment: (id) => onOpenRef.current(id),
      }),
    ];
  }, [enableComments]);

  // ── Cleanup portals on unmount ───────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Detach all portal host nodes on unmount.
      setPortals((prev) => {
        for (const p of prev) {
          p.domNode.remove();
        }
        return [];
      });
    };
  }, []);

  // ── Widget handlers ──────────────────────────────────────────────────────

  const closePortal = useCallback((commentId: string) => {
    setPortals((prev) => {
      const portal = prev.find((p) => p.commentId === commentId);
      portal?.domNode.remove();
      return prev.filter((p) => p.commentId !== commentId);
    });
  }, []);

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

  // ── Per-portal text state ────────────────────────────────────────────────
  // Track draft text per open portal so the widget is controlled.

  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});

  const handleTextChange = useCallback((commentId: string, text: string) => {
    setDraftTexts((prev) => ({ ...prev, [commentId]: text }));
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <CmEditor
        {...editorProps}
        extraExtensions={commentExtensions}
        onViewReady={(view) => {
          viewRef.current = view;
        }}
      />
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
          portal.domNode,
        );
      })}
    </>
  );
}
