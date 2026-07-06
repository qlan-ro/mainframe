import type { FindMatch } from './find-in-chat-store';

/**
 * Search the visible chat messages for query matches.
 * Walks [data-mf-chat-thread] → [data-message-id] → [data-text-part] and emits
 * a FindMatch per case-insensitive substring hit (flat char offsets within each
 * part's textContent). Pure over the rendered DOM — the DOM only ever shows the
 * active chat, so no chatId is needed. v1 scope: text parts only.
 */
export function searchMessages(query: string): FindMatch[] {
  if (!query) return [];

  const lower = query.toLowerCase();
  const matches: FindMatch[] = [];

  const threadEl = document.querySelector('[data-mf-chat-thread]');
  if (!threadEl) return [];

  const messageEls = threadEl.querySelectorAll('[data-message-id]');
  messageEls.forEach((msgEl) => {
    const messageId = msgEl.getAttribute('data-message-id') ?? '';
    const textEls = msgEl.querySelectorAll('[data-text-part]');
    textEls.forEach((textEl, partIndex) => {
      const text = textEl.textContent ?? '';
      const textLower = text.toLowerCase();
      let idx = 0;
      while (idx < textLower.length) {
        const found = textLower.indexOf(lower, idx);
        if (found === -1) break;
        matches.push({ messageId, partIndex, charStart: found, charEnd: found + query.length });
        idx = found + 1;
      }
    });
  });

  return matches;
}

/**
 * Convert flat character offsets within an element's textContent into a Range
 * spanning the underlying text nodes (markdown splits text across nested nodes).
 */
export function rangeFromOffsets(root: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (!startNode && pos + len > start) {
      startNode = node;
      startOffset = start - pos;
    }
    if (startNode && pos + len >= end) {
      endNode = node;
      endOffset = end - pos;
      break;
    }
    pos += len;
    node = walker.nextNode() as Text | null;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
