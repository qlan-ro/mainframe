export interface ReadingAnchor {
  range: Range;
  node: Node;
  offset: number;
  width: number;
}

export function captureReadingAnchor(viewport: HTMLElement, previous: ReadingAnchor | null): ReadingAnchor | null {
  const width = viewport.clientWidth;
  if (!width || (previous && previous.width !== width)) return previous;
  const box = viewport.getBoundingClientRect();
  const range = viewport.ownerDocument.caretRangeFromPoint?.(box.left + width / 2, box.top + 12);
  if (!range || !viewport.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE)
    return null;
  range.setEnd(range.startContainer, Math.min(range.startOffset + 1, range.startContainer.textContent?.length ?? 0));
  return { range, node: range.startContainer, offset: range.getBoundingClientRect().top - box.top, width };
}

export function restoreReadingAnchor(viewport: HTMLElement, anchor: ReadingAnchor | null): ReadingAnchor | null {
  if (!anchor || anchor.width === viewport.clientWidth) return anchor;
  if (anchor.range.startContainer !== anchor.node || !viewport.contains(anchor.node)) return null;
  const offset = anchor.range.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  viewport.scrollTop += offset - anchor.offset;
  return captureReadingAnchor(viewport, null);
}
