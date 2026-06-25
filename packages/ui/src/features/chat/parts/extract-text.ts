/**
 * Walks a React node tree and extracts the concatenated string content.
 * Used by ReadMoreBubble to estimate rendered character length for clamping.
 */
import type { ReactNode } from 'react';

export function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node !== null && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return '';
}
