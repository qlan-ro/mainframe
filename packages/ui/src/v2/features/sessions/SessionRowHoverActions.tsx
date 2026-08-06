/**
 * Pin / tag / archive, revealed on row hover — inline in the title line, just
 * before the timestamp.
 *
 * Inline rather than the stock `SidebarMenuAction` overlay: parked over the
 * time slot, the cluster needed a padding reserve on the title and an opacity
 * fade on the time, and sweeping the pointer down the list animated both on
 * every row.
 *
 * The row MOUNTS this from its own hover state rather than toggling it with a
 * CSS `group-hover` display flip: a display flip leaves an open Hint tooltip
 * anchored to a zero-rect element the instant the pointer leaves the row, and
 * Radix parks orphaned content at the window's top-left. Unmounting the
 * cluster takes the tooltip down with its trigger.
 *
 * The cluster lives INSIDE the row's `<button>`, so these are `role="button"`
 * spans, deliberately unfocusable — a nested `<button>` is invalid HTML, and a
 * focusable child would drag the row through focus-within states on every
 * sweep. Keyboard access to the same actions is the row's context menu.
 */
import type { MouseEvent, ReactNode } from 'react';
import { ArchiveIcon, PinIcon, PinOffIcon, TagIcon } from 'lucide-react';
import { Hint } from '@v2/components/ui/hint';

interface RowHoverActionsProps {
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onTags: (rect: DOMRect) => void;
  onArchive: () => void;
}

/** The row itself is the select target, so every action has to swallow its click. */
const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
  fn();
};

function ActionGlyph({
  label,
  testId,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  onClick: (e: MouseEvent<HTMLSpanElement>) => void;
  children: ReactNode;
}) {
  return (
    <Hint label={label}>
      <span
        role="button"
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
        className="flex size-4.5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-3.5 [&>svg]:shrink-0"
      >
        {children}
      </span>
    </Hint>
  );
}

export function RowHoverActions({ pinned, onPin, onUnpin, onTags, onArchive }: RowHoverActionsProps) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <ActionGlyph
        label={pinned ? 'Unpin' : 'Pin'}
        testId="sessions-row-action-pin"
        onClick={stop(pinned ? onUnpin : onPin)}
      >
        {pinned ? <PinOffIcon /> : <PinIcon />}
      </ActionGlyph>
      <ActionGlyph
        label="Tags"
        testId="sessions-row-action-tags"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onTags(e.currentTarget.getBoundingClientRect());
        }}
      >
        <TagIcon />
      </ActionGlyph>
      <ActionGlyph label="Archive" testId="sessions-row-action-archive" onClick={stop(onArchive)}>
        <ArchiveIcon />
      </ActionGlyph>
    </span>
  );
}
