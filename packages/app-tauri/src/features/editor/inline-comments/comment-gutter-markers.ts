/**
 * comment-gutter-markers — CM6 GutterMarker classes and the buildCommentGutter
 * Extension factory for the inline comment gutter.
 *
 * Gutter hover implementation:
 *   The earlier `.cm-line:hover ~ ...` CSS approach doesn't work because the
 *   gutter precedes (not follows) the content pane in DOM order and CSS can't
 *   select preceding siblings. Instead we track the hovered line via a
 *   StateField driven by `domEventHandlers` on the EditorView — mousemove over
 *   the scroller updates the field, mouseleave clears it. The GutterMarker for
 *   the add button reads this field to decide whether to render visibly.
 *
 * Add-marker design:
 *   15×15px rounded-[4px] bg-primary button containing a white chat/comment glyph
 *   at 9px — matches the prototype (03-content.jsx line 988).
 *
 * Exports:
 *   CommentGutterMarker   — GutterMarker shown on lines that already have a comment (●)
 *   AddCommentMarker      — GutterMarker shown on the hovered empty line
 *   CommentGutterCallbacks — callback interface for gutter interaction
 *   buildCommentGutter    — factory that returns the full CM6 Extension array
 */
import { GutterMarker, gutter, EditorView } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { commentField } from './comment-gutter-state';

// ── Hovered-line StateField ──────────────────────────────────────────────────

/** StateEffect to update which 1-based line number is hovered (null = none). */
const setHoveredLine = StateEffect.define<number | null>();

/** StateField tracking the 1-based hovered line number (null when no line is hovered). */
const hoveredLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHoveredLine)) return effect.value;
    }
    return value;
  },
});

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

// ── GutterMarker for hovered empty lines (add button) ────────────────────────

export class AddCommentMarker extends GutterMarker {
  private readonly line: number;
  private readonly onAdd: (line: number) => void;
  private readonly visible: boolean;

  constructor(line: number, onAdd: (line: number) => void, visible: boolean) {
    super();
    this.line = line;
    this.onAdd = onAdd;
    this.visible = visible;
  }

  toDOM(): Text | Element {
    const btn = document.createElement('button');
    btn.className = 'cm-comment-gutter-add';
    btn.setAttribute('aria-label', 'Add comment');
    btn.setAttribute('type', 'button');
    btn.style.cssText = [
      'width:15px',
      'height:15px',
      'padding:0',
      'border:none',
      'border-radius:4px',
      'background:var(--primary)',
      'cursor:pointer',
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      `opacity:${this.visible ? '1' : '0'}`,
    ].join(';');

    // White chat-bubble glyph via SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '9');
    svg.setAttribute('height', '9');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    // message-square path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
    svg.appendChild(path);
    btn.appendChild(svg);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onAdd(this.line);
    });
    return btn;
  }

  eq(other: GutterMarker): boolean {
    return (
      other instanceof AddCommentMarker &&
      other.line === this.line &&
      other.visible === this.visible
    );
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
    hoveredLineField,
    commentField,
    // Track hovered line number via domEventHandlers on the scroller.
    EditorView.domEventHandlers({
      mousemove(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const lineNum = view.state.doc.lineAt(pos).number;
        const current = view.state.field(hoveredLineField);
        if (current !== lineNum) {
          view.dispatch({ effects: [setHoveredLine.of(lineNum)] });
        }
        return false;
      },
      mouseleave(_event, view) {
        const current = view.state.field(hoveredLineField);
        if (current !== null) {
          view.dispatch({ effects: [setHoveredLine.of(null)] });
        }
        return false;
      },
    }),
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
        // Line has no comment — show the add-marker (visible only when hovered).
        const hoveredLine = view.state.field(hoveredLineField);
        const visible = hoveredLine === lineInfo.number;
        return new AddCommentMarker(lineInfo.number, onAddComment, visible);
      },
    }),
    EditorView.theme({
      '.cm-comment-gutter': {
        width: '22px',
        borderRight: '1px solid var(--border)',
      },
      '.cm-comment-gutter .cm-gutterElement': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }),
  ];
}
