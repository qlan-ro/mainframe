/**
 * comment-gutter — CM6 gutter extension for inline comment markers.
 *
 * Exports:
 *   commentField          — StateField<DecorationSet> (gutter + block-widget decorations)
 *   addCommentEffect      — StateEffect to add a comment entry (anchored by doc position)
 *   deleteCommentEffect   — StateEffect to remove a comment entry by id
 *   getCommentsFromState  — helper to read comment anchors from any EditorState
 *   buildCommentGutter    — factory returning the full CM6 Extension
 *
 * Comment anchors are stored as document **positions** (not line numbers) and
 * mapped through `tr.changes.mapPos` on every transaction so that typing above
 * a comment does not shift its marker to the wrong line.
 *
 * Two decoration kinds are produced by a single StateField:
 *   • A gutter marker on the anchored line (via a separate gutter() that reads
 *     the same field and looks up line numbers from mapped positions).
 *   • A block-widget decoration (`Decoration.widget({ block: true, side: 1 })`)
 *     placed after the anchored line.  The widget's `toDOM()` returns a stable
 *     host <div> that CmEditorWithComments portals the React card into.
 *
 * The React widget (InlineCommentWidget) is mounted OUTSIDE this extension —
 * the extension drives it by calling the callbacks; the widget portal is owned
 * by CmEditorWithComments.
 */
import {
  StateField,
  StateEffect,
  RangeSet,
  RangeSetBuilder,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { GutterMarker, gutter, Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

// ── Shared state shape ───────────────────────────────────────────────────────

export interface InlineCommentState {
  id: string;
  /** Document character offset (0-based) anchoring this comment. Mapped on edits. */
  pos: number;
  text: string;
  /**
   * @deprecated kept for backward-compat with legacy tests and callers that
   * passed/read `line`.  Derived from pos at query time — not stored.
   */
  line?: number;
}

// ── StateEffects ─────────────────────────────────────────────────────────────

export interface AddCommentPayload {
  id: string;
  /** 1-based line number. The StateField converts this to a doc position internally. */
  line: number;
  text: string;
}

export const addCommentEffect = StateEffect.define<AddCommentPayload>();
export const deleteCommentEffect = StateEffect.define<string>(); // id

// ── Internal anchor map ──────────────────────────────────────────────────────

interface CommentAnchor {
  id: string;
  pos: number;
  text: string;
}

// ── Block-widget WidgetType ──────────────────────────────────────────────────

/**
 * CM6 WidgetType that owns the stable host <div> for one comment's React portal.
 *
 * `toDOM()` returns the same element every time (it is created once on
 * construction so CM6 never tears it down between viewport updates).
 * `destroy()` calls the registered cleanup callback so the portal is removed
 * when the decoration is deleted.
 */
export class CommentBlockWidget extends WidgetType {
  readonly commentId: string;
  private readonly _host: HTMLDivElement;
  private _onDestroy: (() => void) | null = null;

  constructor(commentId: string) {
    super();
    this.commentId = commentId;
    this._host = document.createElement('div');
    this._host.className = 'cm-comment-widget-host';
    this._host.setAttribute('data-testid', 'editor-comment-widget');
    this._host.setAttribute('data-comment-id', commentId);
    this._host.style.width = '100%';
  }

  /** Returns the stable host element into which the React portal is rendered. */
  get hostElement(): HTMLDivElement {
    return this._host;
  }

  /** Register a callback that fires when CM6 destroys this widget decoration. */
  setDestroyCallback(cb: () => void): void {
    this._onDestroy = cb;
  }

  toDOM(): HTMLElement {
    return this._host;
  }

  destroy(): void {
    this._onDestroy?.();
  }

  eq(other: WidgetType): boolean {
    return other instanceof CommentBlockWidget && other.commentId === this.commentId;
  }

  /** Block widgets don't participate in line height estimation. */
  get estimatedHeight(): number {
    return -1;
  }
}

// ── StateField: position-anchored anchor list ────────────────────────────────
//
// We keep a separate Map<id, CommentAnchor> (not a DecorationSet) as the
// canonical store because DecorationSets can only be iterated; they can't be
// efficiently looked up by id or mutated.  The DecorationSet is rebuilt from
// the anchor map on every transaction that changes it.

interface CommentFieldValue {
  anchors: CommentAnchor[];
  /** Decoration set holding ONE block widget per anchor.  Rebuilt on change. */
  decorations: DecorationSet;
  /** Widget instances keyed by commentId for stable host access. */
  widgets: Map<string, CommentBlockWidget>;
}

function buildDecorationsFromAnchors(
  anchors: CommentAnchor[],
  existing: Map<string, CommentBlockWidget>,
): { decorations: DecorationSet; widgets: Map<string, CommentBlockWidget> } {
  if (anchors.length === 0) {
    return { decorations: RangeSet.empty as DecorationSet, widgets: new Map() };
  }

  const widgets = new Map<string, CommentBlockWidget>();
  const builder = new RangeSetBuilder<Decoration>();

  // RangeSetBuilder requires ranges to be added in order.
  const sorted = [...anchors].sort((a, b) => a.pos - b.pos);

  for (const anchor of sorted) {
    // Reuse existing widget instance to preserve the host DOM element and any
    // active React portal mounted into it.
    const widget = existing.get(anchor.id) ?? new CommentBlockWidget(anchor.id);
    widgets.set(anchor.id, widget);
    builder.add(anchor.pos, anchor.pos, Decoration.widget({ widget, block: true, side: 1 }));
  }

  return { decorations: builder.finish(), widgets };
}

export const commentField = StateField.define<CommentFieldValue>({
  create() {
    return { anchors: [], decorations: RangeSet.empty as DecorationSet, widgets: new Map() };
  },

  update(value, tr: Transaction) {
    // 1. Map existing anchor positions through the document changes.
    let anchors = value.anchors.map((a) => ({
      ...a,
      pos: tr.changes.mapPos(a.pos, 1),
    }));

    // 2. Apply any add/delete effects.
    let changed = !tr.changes.empty;
    for (const effect of tr.effects) {
      if (effect.is(addCommentEffect)) {
        changed = true;
        // Convert the 1-based line number to a document position (start of line).
        const totalLines = tr.state.doc.lines;
        const safeLineNum = Math.max(1, Math.min(effect.value.line, totalLines));
        const pos = tr.state.doc.line(safeLineNum).from;
        anchors = [...anchors, { id: effect.value.id, pos, text: effect.value.text }];
      } else if (effect.is(deleteCommentEffect)) {
        changed = true;
        anchors = anchors.filter((a) => a.id !== effect.value);
      }
    }

    if (!changed) return value;

    // 3. Rebuild decoration set, reusing existing widget instances.
    const { decorations, widgets } = buildDecorationsFromAnchors(anchors, value.widgets);
    return { anchors, decorations, widgets };
  },

  provide(field) {
    return EditorView.decorations.from(field, (v) => v.decorations);
  },
});

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Read comment state as { id, pos, line } entries from any EditorState that
 * includes commentField.  `line` is 1-based, derived from pos.
 *
 * NOTE: `commentField` is bundled inside `buildCommentGutter`.  Do NOT add it
 * again to the extension list — registering the same StateField twice causes a
 * CM6 "duplicate field" error.  This export exists for unit tests that build a
 * minimal EditorState without the full gutter.
 */
export function getCommentsFromState(state: {
  field: (f: typeof commentField) => CommentFieldValue;
  doc: { lineAt: (pos: number) => { number: number } };
}): InlineCommentState[] {
  const value = state.field(commentField);
  return value.anchors.map((a) => ({
    id: a.id,
    pos: a.pos,
    line: state.doc.lineAt(a.pos).number,
    text: a.text,
  }));
}

/**
 * Get the stable host DOM element for a comment's block widget.
 * Returns undefined if the commentField is not active or the id is unknown.
 */
export function getCommentWidget(
  state: { field: (f: typeof commentField) => CommentFieldValue },
  commentId: string,
): CommentBlockWidget | undefined {
  return state.field(commentField).widgets.get(commentId);
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
        const { anchors } = view.state.field(commentField);
        // Find a comment whose position falls on this line.
        const lineInfo = view.state.doc.lineAt(line.from);
        const hit = anchors.find((a) => {
          const commentLine = view.state.doc.lineAt(a.pos);
          return commentLine.number === lineInfo.number;
        });
        if (hit) {
          return new CommentGutterMarker(hit.id, onOpenComment);
        }
        return null;
      },
      domEventHandlers: {
        click(view, line) {
          const lineNum = view.state.doc.lineAt(line.from).number;
          const { anchors } = view.state.field(commentField);
          const existing = anchors.find((a) => {
            const commentLine = view.state.doc.lineAt(a.pos);
            return commentLine.number === lineNum;
          });
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
