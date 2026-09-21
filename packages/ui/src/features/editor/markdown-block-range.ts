/**
 * markdown-block-range — pure hast-position → source-line-range mapper for
 * annotatable markdown blocks (p, h1-h6, li, pre, blockquote, table).
 */
import type { Element } from 'hast';
import { MAX_INLINE_LINES } from './inline-comments/resolve-comment-range';

export interface BlockRange {
  startLine: number;
  endLine: number;
  lineContent: string;
}

const ANNOTATED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'table']);

/** Maps a hast node's mdast-derived position to its source-line range and raw quoted text. */
export function getBlockRange(node: Element, source: string): BlockRange | null {
  const position = node.position;
  if (!position) return null;

  const { startLine, endLine } = { startLine: position.start.line, endLine: position.end.line };
  const lineCount = endLine - startLine + 1;
  if (lineCount > MAX_INLINE_LINES) {
    return { startLine, endLine, lineContent: '' };
  }

  const lineContent = source
    .split('\n')
    .slice(startLine - 1, endLine)
    .join('\n');
  return { startLine, endLine, lineContent };
}

/**
 * True when an annotated descendant, at any depth through unannotated
 * containers (e.g. ul/ol), shares the node's exact start/end line — the
 * signal that the outer block is a pass-through wrapper and should render
 * no control of its own (spec: only the innermost same-range block does).
 */
export function hasAnnotatedDescendantWithSameRange(node: Element): boolean {
  if (!node.position) return false;
  const { start, end } = node.position;

  function search(children: Element['children']): boolean {
    for (const child of children) {
      if (child.type !== 'element') continue;
      const childPosition = child.position;
      const isMatch =
        ANNOTATED_TAGS.has(child.tagName) &&
        childPosition !== undefined &&
        childPosition.start.line === start.line &&
        childPosition.end.line === end.line;
      if (isMatch || search(child.children)) return true;
    }
    return false;
  }

  return search(node.children);
}
