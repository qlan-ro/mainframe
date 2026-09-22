/**
 * markdown-block-range — pure hast-position → source-line-range mapper for
 * annotatable markdown blocks (p, h1-h6, li, pre, blockquote, table).
 */
import type { ExtraProps } from 'react-markdown';
import { MAX_INLINE_LINES } from './inline-comments/resolve-comment-range';

// `hast` isn't a direct dependency of this package; react-markdown re-exports
// the node type it actually passes (fact: node_modules/react-markdown/lib/index.d.ts:160).
type HastElement = NonNullable<ExtraProps['node']>;

export interface BlockRange {
  startLine: number;
  endLine: number;
  lineContent: string;
}

const ANNOTATED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'table']);

/** CodeMirror's own line split, so a quote matches "the same lines in Source" (@codemirror/state/dist/index.js:608). */
const SOURCE_LINE_SPLIT = /\r\n?|\n/;

/** Maps a hast node's mdast-derived position to its source-line range and raw quoted text. */
export function getBlockRange(node: HastElement, source: string): BlockRange | null {
  const position = node.position;
  if (!position) return null;

  const startLine = position.start.line;
  const endLine = position.end.line;
  const lineCount = endLine - startLine + 1;
  if (lineCount > MAX_INLINE_LINES) {
    return { startLine, endLine, lineContent: '' };
  }

  const lineContent = source
    .split(SOURCE_LINE_SPLIT)
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
export function hasAnnotatedDescendantWithSameRange(node: HastElement): boolean {
  if (!node.position) return false;
  const { start, end } = node.position;

  function search(children: HastElement['children']): boolean {
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
