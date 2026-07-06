/**
 * SessionContextMenu — shadcn ContextMenu wrapping a session row.
 * Pin/Unpin, Rename, Archive, Copy Session ID (D11).
 * Wraps children (the ThreadListItemPrimitive.Root trigger area).
 */
import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { CopyIcon, ArchiveIcon, PencilIcon, PinIcon, PinOffIcon, TagIcon } from 'lucide-react';

interface SessionContextMenuProps {
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onRename: () => void;
  onTags: () => void;
  onArchive: () => void;
  claudeSessionId?: string;
  children: ReactNode;
}

export function SessionContextMenu({
  pinned,
  onPin,
  onUnpin,
  onRename,
  onTags,
  onArchive,
  claudeSessionId,
  children,
}: SessionContextMenuProps) {
  function handleCopyId() {
    if (claudeSessionId != null) {
      void navigator.clipboard.writeText(claudeSessionId);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem data-testid="sessions-ctx-pin" onSelect={pinned ? onUnpin : onPin}>
          {pinned ? <PinOffIcon className="mr-2 size-3.5" /> : <PinIcon className="mr-2 size-3.5" />}
          {pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuItem data-testid="sessions-ctx-rename" onSelect={onRename}>
          <PencilIcon className="mr-2 size-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem data-testid="sessions-ctx-tags" onSelect={onTags}>
          <TagIcon className="mr-2 size-3.5" />
          Tags
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="sessions-ctx-archive" onSelect={onArchive} className="text-muted-foreground">
          <ArchiveIcon className="mr-2 size-3.5" />
          Archive
        </ContextMenuItem>
        {claudeSessionId != null && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem data-testid="sessions-ctx-copy-id" onSelect={handleCopyId}>
              <CopyIcon className="mr-2 size-3.5" />
              Copy Session ID
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
