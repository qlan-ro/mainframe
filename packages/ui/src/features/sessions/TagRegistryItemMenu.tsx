/**
 * Right-click menu on a tag registry row — rename, recolor, delete.
 *
 * The menu only names the action; the popover above it owns the rename input,
 * the palette and the delete confirm, because all three outlive the menu (Radix
 * unmounts menu content on select).
 */
import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TagRegistryItemMenuProps {
  tagName: string;
  onRename: (name: string) => void;
  onRecolor: (name: string) => void;
  onDelete: (name: string) => void;
  children: ReactNode;
}

export function TagRegistryItemMenu({ tagName, onRename, onRecolor, onDelete, children }: TagRegistryItemMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* No close-focus-restore: every action here opens something that wants
          focus (rename input, palette, confirm). The default restore lands on
          the still-mounted CommandInput one macrotask later, which blurs the
          just-mounted rename input and silently commits the unchanged name. */}
      <ContextMenuContent className="min-w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
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
