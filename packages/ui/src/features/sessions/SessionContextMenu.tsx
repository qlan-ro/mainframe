/**
 * Right-click menu for a session row: pin, rename, tags, archive, copy id.
 *
 * Wraps its child — the row is the trigger — so the whole row area responds,
 * including the parts the hover actions overlay.
 */
import type { ReactNode } from 'react';
import { ArchiveIcon, CopyIcon, PencilIcon, PinIcon, PinOffIcon, TagIcon } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

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
    if (claudeSessionId != null) void navigator.clipboard.writeText(claudeSessionId);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem data-testid="sessions-ctx-pin" onSelect={pinned ? onUnpin : onPin}>
          {pinned ? <PinOffIcon /> : <PinIcon />}
          {pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuItem data-testid="sessions-ctx-rename" onSelect={onRename}>
          <PencilIcon />
          Rename
        </ContextMenuItem>
        <ContextMenuItem data-testid="sessions-ctx-tags" onSelect={onTags}>
          <TagIcon />
          Tags
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="sessions-ctx-archive" onSelect={onArchive}>
          <ArchiveIcon />
          Archive
        </ContextMenuItem>
        {claudeSessionId != null && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem data-testid="sessions-ctx-copy-id" onSelect={handleCopyId}>
              <CopyIcon />
              Copy Session ID
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
