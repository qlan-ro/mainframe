/**
 * comment-gutter-markers — CM6 GutterMarker classes and the buildCommentGutter
 * Extension factory for the inline comment gutter.
 *
 * Exports:
 *   CommentGutterMarker   — GutterMarker shown on lines that already have a comment (●)
 *   AddCommentMarker      — GutterMarker shown on empty lines (+, hover-only)
 *   CommentGutterCallbacks — callback interface for gutter interaction
 *   buildCommentGutter    — factory that returns the full CM6 Extension array
 */
import { GutterMarker, gutter, EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { commentField } from './comment-gutter-state';

// ── GutterMarker for lines WITH a comment (●) ───────────────────────────────

export class CommentGutterMarker extends GutterMarker {
  private readonly commentId: string;
  private readonly onOpen: (id: string) => void;

  constructor(commentId: string, onOpen: (id: string) => void) {
    super();
    this.commentId = commentId;
    this.onOpen = onOpen;
  }

  toDOM(): Text | Element {
    const el = document.createElement('span');
    el.className = 'cm-comment-gutter-marker';
    el.setAttribute('title', 'View comment');
    el.setAttribute('aria-label', 'View comment');
    el.style.cursor = 'pointer';
    el.style.fontSize = '11px';
    el.style.lineHeight = '1';
    el.style.color = 'var(--primary)';
    el.style.userSelect = 'none';
    el.textContent = '●';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpen(this.commentId);
    });
    return el;
  }

  eq(other: GutterMarker): boolean {
    return other instanceof CommentGutterMarker && other.commentId === this.commentId;
  }
}

// ── GutterMarker for lines WITHOUT a comment (+) ─────────────────────────────

export class AddCommentMarker extends GutterMarker {
  private readonly line: number;
  private readonly onAdd: (line: number) => void;

  constructor(line: number, onAdd: (line: number) => void) {
    super();
    this.line = line;
    this.onAdd = onAdd;
  }

  toDOM(): Text | Element {
    const el = document.createElement('span');
    el.className = 'cm-comment-gutter-add';
    el.setAttribute('aria-label', 'Add comment');
    el.style.cursor = 'pointer';
    el.style.fontSize = '14px';
    el.style.lineHeight = '1';
    el.style.color = 'var(--mf-text-3)';
    el.style.userSelect = 'none';
    el.textContent = '+';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onAdd(this.line);
    });
    return el;
  }

  eq(other: GutterMarker): boolean {
    return other instanceof AddCommentMarker && other.line === this.line;
  }
}

// ── Extension factory ────────────────────────────────────────────────────────

export interface CommentGutterCallbacks {
  /**
   * Called when the user clicks an empty gutter cell — the host should call
   * addComment and dispatch an addCommentEffect with the returned id.
   */
  onAddComment: (line: number) => void;
  /**
   * Called when the user clicks a marker on a line that already has a comment.
   */
  onOpenComment: (id: string) => void;
}

/**
 * Build the CM6 Extension set for the comment gutter.
 *
 * Returns an array of extensions so callers can spread it into
 * EditorState.create({ extensions: [...buildCommentGutter(callbacks)] }).
 */
export function buildCommentGutter(callbacks: CommentGutterCallbacks): Extension {
  const { onAddComment, onOpenComment } = callbacks;

  return [
    commentField,
    gutter({
      class: 'cm-comment-gutter',
      lineMarker(view, line) {
        const { anchors } = view.state.field(commentField);
        const lineInfo = view.state.doc.lineAt(line.from);
        const hit = anchors.find((a) => {
          const commentLine = view.state.doc.lineAt(a.pos);
          return commentLine.number === lineInfo.number;
        });
        if (hit) {
          // Line has a comment — show the ● open-marker.
          return new CommentGutterMarker(hit.id, onOpenComment);
        }
        // Line has no comment — show the hover-'+' add-marker.
        return new AddCommentMarker(lineInfo.number, onAddComment);
      },
    }),
    EditorView.theme({
      '.cm-comment-gutter': {
        width: '18px',
        borderRight: '1px solid var(--border)',
      },
      '.cm-comment-gutter .cm-gutterElement': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      // Hide the '+' add-marker by default; reveal it on row hover.
      '.cm-comment-gutter .cm-gutterElement .cm-comment-gutter-add': {
        opacity: '0',
        transition: 'opacity 0.1s',
      },
      '.cm-line:hover ~ .cm-comment-gutter .cm-gutterElement .cm-comment-gutter-add': {
        opacity: '1',
      },
      '.cm-comment-gutter .cm-gutterElement:hover .cm-comment-gutter-add': {
        opacity: '1',
      },
    }),
  ];
}
