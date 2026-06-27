/**
 * resolve-comment-range — pure helper to determine the effective comment range.
 *
 * Reads `state.selection.main`. When the selection is non-empty it wins over the
 * clicked line; otherwise the single clicked line is used.  Content is capped at
 * 50 lines to avoid sending large diffs — beyond that limit `lineContent` is `''`
 * to signal "too large to inline" (mirrors the desktop formatter behaviour).
 */
import type { EditorState } from '@codemirror/state';

export interface CommentRange {
  startLine: number;
  endLine: number;
  lineContent: string;
}

const MAX_INLINE_LINES = 50;

/**
 * Resolve the effective line range for a new comment.
 *
 * @param state       - Live CM6 EditorState (has `.selection` and `.doc`).
 * @param clickedLine - 1-based line number the user clicked in the gutter.
 */
export function resolveCommentRange(state: EditorState, clickedLine: number): CommentRange {
  const { main } = state.selection;

  let startLine: number;
  let endLine: number;

  if (!main.empty) {
    // Non-empty selection: use the covered lines.
    startLine = state.doc.lineAt(main.from).number;
    // When `head` (to) lands exactly at the start of a line the user didn't
    // visually include that line — e.g. triple-click selects "a\n" but the
    // cursor sits at the first char of the next line.  Use `main.to` as-is;
    // the brief specifies doc.lineAt(to).number which is correct for partial
    // line coverage.
    endLine = state.doc.lineAt(main.to).number;
  } else {
    // Empty selection: single clicked line.
    const totalLines = state.doc.lines;
    const safeLine = Math.max(1, Math.min(clickedLine, totalLines));
    startLine = safeLine;
    endLine = safeLine;
  }

  const lineCount = endLine - startLine + 1;
  if (lineCount > MAX_INLINE_LINES) {
    return { startLine, endLine, lineContent: '' };
  }

  // Join the text of startLine..endLine with newlines.
  const lines: string[] = [];
  for (let n = startLine; n <= endLine; n++) {
    lines.push(state.doc.line(n).text);
  }

  return { startLine, endLine, lineContent: lines.join('\n') };
}
