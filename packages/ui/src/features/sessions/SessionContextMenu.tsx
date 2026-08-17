/**
 * Right-click menu for a session row: pin, rename, tags, archive, copy id.
 *
 * Wraps its child — the row is the trigger — so the whole row area responds,
 * including the parts the hover actions overlay.
 */
import type { ReactNode } from 'react';
import { ArchiveIcon, Columns2, CopyIcon, PencilIcon, PinIcon, PinOffIcon, TagIcon } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface SessionContextMenuProps {
  pinned: boolean;
  /** The row suppresses its hover card while the menu is up. */
  onOpenChange?: (open: boolean) => void;
  onPin: () => void;
  onUnpin: () => void;
  onRename: () => void;
  onTags: () => void;
  onArchive: () => void;
  onOpenInSplit: () => void;
  claudeSessionId?: string;
  children: ReactNode;
}

export function SessionContextMenu({
  pinned,
  onOpenChange,
  onPin,
  onUnpin,
  onRename,
  onTags,
  onArchive,
  onOpenInSplit,
  claudeSessionId,
  children,
}: SessionContextMenuProps) {
  function handleCopyId() {
    if (claudeSessionId != null) void navigator.clipboard.writeText(claudeSessionId);
  }

  return (
    <ContextMenu onOpenChange={onOpenChange}>
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
        <ContextMenuItem data-testid="sessions-ctx-open-split" onSelect={onOpenInSplit}>
          <Columns2 />
          Open in Split
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
