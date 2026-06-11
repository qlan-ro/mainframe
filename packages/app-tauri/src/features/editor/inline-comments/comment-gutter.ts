/**
 * comment-gutter — CM6 gutter extension for inline comment markers.
 *
 * Exports:
 *   commentField          — StateField<InlineCommentState[]> (authoritative in-view state)
 *   addCommentEffect      — StateEffect to add a comment entry
 *   deleteCommentEffect   — StateEffect to remove a comment entry by id
 *   getCommentsFromState  — helper to read commentField value from any EditorState
 *   buildCommentGutter    — factory returning the full CM6 Extension
 *
 * The gutter renders a glyph marker on every line that has a comment.
 * Clicking a gutterless line fires onAddComment(line); clicking a marked
 * line fires onOpenComment(commentId).
 *
 * The React widget (InlineCommentWidget) is mounted OUTSIDE this extension —
 * the extension drives it by calling the callbacks; the widget portal is owned
 * by CmEditor.
 */
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { GutterMarker, gutter, EditorView } from '@codemirror/view';

// ── Shared state shape ───────────────────────────────────────────────────────

export interface InlineCommentState {
  id: string;
  line: number;
  text: string;
}

// ── StateEffects ─────────────────────────────────────────────────────────────

export const addCommentEffect = StateEffect.define<InlineCommentState>();
export const deleteCommentEffect = StateEffect.define<string>(); // id

// ── StateField ───────────────────────────────────────────────────────────────

export const commentField = StateField.define<InlineCommentState[]>({
  create() {
    return [];
  },
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(addCommentEffect)) {
        next = [...next, effect.value];
      } else if (effect.is(deleteCommentEffect)) {
        next = next.filter((c) => c.id !== effect.value);
      }
    }
    return next;
  },
});

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Read comment state from any EditorState that includes commentField.
 *
 * NOTE: `commentField` is already bundled inside `buildCommentGutter`. Do NOT
 * add it again to the extension list — registering the same StateField twice
 * causes a CM6 "duplicate field" error. This export exists only for unit tests
 * that build a minimal EditorState without the full gutter.
 */
export function getCommentsFromState(state: {
  field: (f: typeof commentField) => InlineCommentState[];
}): InlineCommentState[] {
  return state.field(commentField);
}

// ── GutterMarker for commented lines ────────────────────────────────────────

class CommentGutterMarker extends GutterMarker {
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
        const comments = view.state.field(commentField);
        const lineNum = view.state.doc.lineAt(line.from).number;
        const hit = comments.find((c) => c.line === lineNum);
        if (hit) {
          return new CommentGutterMarker(hit.id, onOpenComment);
        }
        return null;
      },
      domEventHandlers: {
        click(view, line) {
          const lineNum = view.state.doc.lineAt(line.from).number;
          const comments = view.state.field(commentField);
          const existing = comments.find((c) => c.line === lineNum);
          if (!existing) {
            onAddComment(lineNum);
          }
          return true;
        },
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
        cursor: 'pointer',
      },
    }),
  ];
}
