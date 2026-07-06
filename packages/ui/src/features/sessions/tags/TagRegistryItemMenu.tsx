/**
 * Right-click menu for a tag registry row — Rename / Change color / Delete.
 *
 * Uses the shadcn ContextMenu compound (Radix-backed, focus-trapped,
 * keyboard-navigable) rather than a hand-rolled fixed-position div. The
 * parent (TagPopover) owns the rename input, recolor panel, and the delete
 * confirm dialog; this component only emits the chosen action.
 */
import React from 'react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../../../components/ui/context-menu';

interface Props {
  tagName: string;
  onRename: (name: string) => void;
  onRecolor: (name: string) => void;
  onDelete: (name: string) => void;
  children: React.ReactNode;
}

export function TagRegistryItemMenu({ tagName, onRename, onRecolor, onDelete, children }: Props): React.ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        <ContextMenuItem data-testid="sessions-tag-registry-rename" onSelect={() => onRename(tagName)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem data-testid="sessions-tag-registry-recolor" onSelect={() => onRecolor(tagName)}>
          Change color
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="sessions-tag-registry-delete"
          variant="destructive"
          onSelect={() => onDelete(tagName)}
        >
          Delete from all sessions
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
