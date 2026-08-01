/**
 * The windowed row list both sidebar dialogs scroll.
 *
 * Neither list is bounded by anything the user chose: the archive holds every
 * session ever closed, and a long-lived project has thousands of CLI
 * transcripts on disk. Mounting them all cost 7k nodes and ~400ms of stall on
 * open, so only what the cap can show is mounted.
 *
 * `totalListHeightChanged` keeps a short list honest — three rows render three
 * rows tall, not a 340px box with a gap under it.
 */
import { useState, type ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';

/** Roughly six rows — past that the dialog would outgrow a small window. */
const MAX_HEIGHT = 340;

interface FooterContext {
  footer: ReactNode;
}

/**
 * Module scope, and fed through Virtuoso's `context`: an inline `Footer` would
 * be a new component identity every render, remounting the paging sentinel and
 * re-firing its observer.
 */
function ListFooter({ context }: { context?: FooterContext }) {
  return <>{context?.footer ?? null}</>;
}

const COMPONENTS = { Footer: ListFooter };

interface DialogRowListProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Rendered below the last row; the import list hangs its paging sentinel here. */
  footer?: ReactNode;
}

export function DialogRowList<T>({ items, itemKey, renderItem, footer = null }: DialogRowListProps<T>) {
  const [contentHeight, setContentHeight] = useState<number>();

  return (
    <Virtuoso
      className="pr-2"
      style={{ height: Math.min(contentHeight ?? MAX_HEIGHT, MAX_HEIGHT) }}
      totalListHeightChanged={setContentHeight}
      data={items}
      context={{ footer }}
      components={COMPONENTS}
      computeItemKey={(_, item) => itemKey(item)}
      itemContent={(_, item) => renderItem(item)}
    />
  );
}
