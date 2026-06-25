/**
 * comment-gutter-state — CM6 StateField, StateEffects, and block-widget type
 * for the inline comment gutter extension.
 *
 * Exports:
 *   InlineCommentState   — public shape returned by getCommentsFromState
 *   AddCommentPayload    — effect payload for addCommentEffect
 *   addCommentEffect     — StateEffect to add a comment (anchored by line number)
 *   deleteCommentEffect  — StateEffect to remove a comment by id
 *   CommentBlockWidget   — CM6 WidgetType; owns the stable host <div>
 *   commentField         — StateField<CommentFieldValue>
 *   getCommentsFromState — read comment anchors from any EditorState
 *   getCommentWidget     — get the stable widget instance by id
 *
 * Comment anchors are stored as document **positions** (not line numbers) and
 * mapped through `tr.changes.mapPos` on every transaction so that typing above
 * a comment does not shift its marker to the wrong line.
 */
import { StateField, StateEffect, RangeSet, RangeSetBuilder, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
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
// We keep a separate CommentAnchor[] (not a DecorationSet) as the canonical
// store because DecorationSets can only be iterated; they can't be efficiently
// looked up by id or mutated.  The DecorationSet is rebuilt from the anchor
// list on every transaction that changes it.

export interface CommentFieldValue {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
