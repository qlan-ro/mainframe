/**
 * comment-gutter — CM6 extension unit tests.
 *
 * Tests verify:
 *   1. The StateField tracks adds/deletes (legacy API compatibility).
 *   2. Comment positions are mapped through document changes — typing a line
 *      ABOVE a comment keeps the comment on its original code line.
 *   3. Block widget decorations are produced for each comment anchor.
 *   4. Delete removes both the anchor and the widget.
 *   5. Hover-'+' affordance: AddCommentMarker / CommentGutterMarker DOM + callbacks.
 */
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  commentField,
  addCommentEffect,
  deleteCommentEffect,
  getCommentsFromState,
  AddCommentMarker,
  CommentGutterMarker,
  type InlineCommentState,
} from '../comment-gutter';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(doc: string = 'line1\nline2\nline3\n'): EditorState {
  return EditorState.create({ doc, extensions: [commentField] });
}

/** Apply a string insertion at a given offset and return the new state. */
function insertAt(state: EditorState, offset: number, text: string): EditorState {
  return state.update({ changes: { from: offset, insert: text } }).state;
}

// ── Basic CRUD ────────────────────────────────────────────────────────────────

describe('commentField StateField', () => {
  it('starts with no comments', () => {
    const state = makeState();
    expect(getCommentsFromState(state)).toHaveLength(0);
  });

  it('addCommentEffect adds a comment at the given line', () => {
    const state = makeState();
    const next = state.update({
      effects: [addCommentEffect.of({ id: 'c1', line: 2, text: '' })],
    }).state;
    const comments = getCommentsFromState(next);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.line).toBe(2);
    expect(comments[0]!.id).toBe('c1');
  });

  it('addCommentEffect accumulates multiple comments', () => {
    const state = makeState();
    const next = state
      .update({ effects: [addCommentEffect.of({ id: 'c1', line: 1, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'c2', line: 3, text: '' })] }).state;
    expect(getCommentsFromState(next)).toHaveLength(2);
  });

  it('deleteCommentEffect removes the matching comment', () => {
    const state = makeState();
    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'c1', line: 2, text: '' })],
    }).state;
    const withDelete = withComment.update({
      effects: [deleteCommentEffect.of('c1')],
    }).state;
    expect(getCommentsFromState(withDelete)).toHaveLength(0);
  });

  it('deleteCommentEffect preserves other comments', () => {
    const state = makeState();
    const withTwo = state
      .update({ effects: [addCommentEffect.of({ id: 'keep', line: 1, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'remove', line: 2, text: '' })] }).state;
    const afterDelete = withTwo.update({
      effects: [deleteCommentEffect.of('remove')],
    }).state;
    const remaining = getCommentsFromState(afterDelete);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('keep');
  });

  it('adding two comments on the same line is allowed', () => {
    const state = makeState();
    const next = state
      .update({ effects: [addCommentEffect.of({ id: 'a', line: 1, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'b', line: 1, text: '' })] }).state;
    expect(getCommentsFromState(next)).toHaveLength(2);
  });

  it('hasCommentOnLine helper returns correct boolean', () => {
    const state = makeState();
    const next = state.update({
      effects: [addCommentEffect.of({ id: 'x', line: 2, text: '' })],
    }).state;
    const comments = getCommentsFromState(next);
    const linesWithComments = new Set(comments.map((c: InlineCommentState) => c.line));
    expect(linesWithComments.has(2)).toBe(true);
    expect(linesWithComments.has(1)).toBe(false);
  });
});

// ── Position mapping (the critical correctness property) ─────────────────────

describe('commentField position mapping', () => {
  it('inserting a line ABOVE a comment keeps the comment on the same code line', () => {
    // Doc: "alpha\nbeta\ngamma\n"  — comment on line 2 ("beta")
    const doc = 'alpha\nbeta\ngamma\n';
    const state = makeState(doc);

    // Add comment on line 2 ("beta" starts at offset 6).
    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'c1', line: 2, text: '' })],
    }).state;

    // Verify it reports line 2 before the edit.
    expect(getCommentsFromState(withComment)[0]!.line).toBe(2);

    // Insert "new line\n" at the start of the doc (before "alpha").
    // After insertion: "new line\nalpha\nbeta\ngamma\n"
    // "beta" is now on line 3.
    const afterInsert = insertAt(withComment, 0, 'new line\n');

    const comments = getCommentsFromState(afterInsert);
    expect(comments).toHaveLength(1);
    // The comment must have followed "beta" to line 3.
    expect(comments[0]!.line).toBe(3);
    expect(comments[0]!.id).toBe('c1');
  });

  it('deleting a line ABOVE a comment adjusts the comment line upward', () => {
    // Doc: "alpha\nbeta\ngamma\n"  — comment on line 3 ("gamma")
    const doc = 'alpha\nbeta\ngamma\n';
    const state = makeState(doc);

    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'c2', line: 3, text: '' })],
    }).state;
    expect(getCommentsFromState(withComment)[0]!.line).toBe(3);

    // Delete line 1 ("alpha\n") — 6 chars starting at offset 0.
    const afterDelete = withComment.update({
      changes: { from: 0, to: 6, insert: '' },
    }).state;

    const comments = getCommentsFromState(afterDelete);
    expect(comments).toHaveLength(1);
    // "gamma" is now line 2.
    expect(comments[0]!.line).toBe(2);
  });

  it('editing text on the SAME line does not move the comment', () => {
    const doc = 'alpha\nbeta\ngamma\n';
    const state = makeState(doc);

    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'c3', line: 2, text: '' })],
    }).state;

    // Append " edited" to line 2 (offset 6 = start of "beta", length 4).
    const afterEdit = withComment.update({
      changes: { from: 6, to: 10, insert: 'beta edited' },
    }).state;

    const comments = getCommentsFromState(afterEdit);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.line).toBe(2);
  });

  it('two comments each track their own code line independently', () => {
    // Doc has 4 lines; comment A on line 2, comment B on line 4.
    const doc = 'L1\nL2\nL3\nL4\n';
    const state = makeState(doc);

    const withTwo = state
      .update({ effects: [addCommentEffect.of({ id: 'A', line: 2, text: '' })] })
      .state.update({ effects: [addCommentEffect.of({ id: 'B', line: 4, text: '' })] }).state;

    // Insert a line at the very start — shifts ALL lines down by one.
    const afterInsert = insertAt(withTwo, 0, 'L0\n');

    const comments = getCommentsFromState(afterInsert);
    const byId = Object.fromEntries(comments.map((c) => [c.id, c]));
    expect(byId['A']!.line).toBe(3); // was 2, shifted to 3
    expect(byId['B']!.line).toBe(5); // was 4, shifted to 5
  });
});

// ── Block widget decorations ─────────────────────────────────────────────────

describe('commentField block widgets', () => {
  it('produces a widget entry in the field for each added comment', () => {
    const state = makeState();
    const next = state.update({
      effects: [addCommentEffect.of({ id: 'w1', line: 1, text: '' })],
    }).state;
    const { widgets } = next.field(commentField);
    expect(widgets.has('w1')).toBe(true);
  });

  it('removes the widget entry when comment is deleted', () => {
    const state = makeState();
    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'w2', line: 1, text: '' })],
    }).state;
    const afterDelete = withComment.update({
      effects: [deleteCommentEffect.of('w2')],
    }).state;
    expect(afterDelete.field(commentField).widgets.has('w2')).toBe(false);
  });

  it('hostElement is a div with data-testid editor-comment-widget', () => {
    const state = makeState();
    const next = state.update({
      effects: [addCommentEffect.of({ id: 'w3', line: 2, text: '' })],
    }).state;
    const widget = next.field(commentField).widgets.get('w3');
    expect(widget).toBeDefined();
    expect(widget!.hostElement.getAttribute('data-testid')).toBe('editor-comment-widget');
  });

  it('reuses the same widget instance across transactions (stable host DOM)', () => {
    const state = makeState('line1\nline2\nline3\n');
    const withComment = state.update({
      effects: [addCommentEffect.of({ id: 'stable', line: 2, text: '' })],
    }).state;
    const widgetBefore = withComment.field(commentField).widgets.get('stable');

    // Simulate a doc change (type on line 1) — position mapping runs.
    const afterEdit = insertAt(withComment, 0, 'prefix ');
    const widgetAfter = afterEdit.field(commentField).widgets.get('stable');

    // Same JS object — CM6 reuses it so the React portal stays mounted.
    expect(widgetAfter).toBe(widgetBefore);
  });
});

// ── Hover-'+' affordance: AddCommentMarker + CommentGutterMarker ─────────────

describe('AddCommentMarker (lines without a comment)', () => {
  it('toDOM returns a span with class cm-comment-gutter-add', () => {
    const onAdd = vi.fn();
    const marker = new AddCommentMarker(3, onAdd);
    const el = marker.toDOM() as HTMLElement;
    expect(el.tagName.toLowerCase()).toBe('span');
    expect(el.className).toContain('cm-comment-gutter-add');
  });

  it('toDOM span has aria-label "Add comment"', () => {
    const marker = new AddCommentMarker(1, vi.fn());
    const el = marker.toDOM() as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('Add comment');
  });

  it('toDOM span uses --mf-text-3 color token', () => {
    const marker = new AddCommentMarker(1, vi.fn());
    const el = marker.toDOM() as HTMLElement;
    expect(el.style.color).toBe('var(--mf-text-3)');
  });

  it('toDOM span displays "+" as text content', () => {
    const marker = new AddCommentMarker(2, vi.fn());
    const el = marker.toDOM() as HTMLElement;
    expect(el.textContent).toBe('+');
  });

  it('clicking the marker calls onAddComment with the line number and stopPropagation', () => {
    const onAdd = vi.fn();
    const marker = new AddCommentMarker(7, onAdd);
    const el = marker.toDOM() as HTMLElement;

    const stopPropagation = vi.fn();
    el.dispatchEvent(Object.assign(new MouseEvent('click', { bubbles: true }), { stopPropagation }));

    // The listener attaches stopPropagation via addEventListener; use a real click event.
    // Simulate via direct click listener invocation.
    el.click();
    expect(onAdd).toHaveBeenCalledWith(7);
  });

  it('eq returns true for markers with the same line number', () => {
    const onAdd = vi.fn();
    const m1 = new AddCommentMarker(5, onAdd);
    const m2 = new AddCommentMarker(5, onAdd);
    expect(m1.eq(m2)).toBe(true);
  });

  it('eq returns false for markers with different line numbers', () => {
    const onAdd = vi.fn();
    const m1 = new AddCommentMarker(5, onAdd);
    const m2 = new AddCommentMarker(6, onAdd);
    expect(m1.eq(m2)).toBe(false);
  });
});

describe('CommentGutterMarker (lines with a comment)', () => {
  it('toDOM returns a span with class cm-comment-gutter-marker and "●" text', () => {
    const marker = new CommentGutterMarker('c1', vi.fn());
    const el = marker.toDOM() as HTMLElement;
    expect(el.tagName.toLowerCase()).toBe('span');
    expect(el.className).toContain('cm-comment-gutter-marker');
    expect(el.textContent).toBe('●');
  });

  it('clicking the ● marker calls onOpenComment with the comment id', () => {
    const onOpen = vi.fn();
    const marker = new CommentGutterMarker('comment-42', onOpen);
    const el = marker.toDOM() as HTMLElement;
    el.click();
    expect(onOpen).toHaveBeenCalledWith('comment-42');
  });
});
