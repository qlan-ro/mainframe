/**
 * FileTreeRowMenu — the right-click context menu shared by file-tree rows
 * (files, folders, and the project root header). Parity with the desktop
 * FilesTab menu: Find in file/folder · Reveal in Finder · Copy Path · Copy
 * Relative Path. `fullPath` is the absolute on-disk path (worktree/project base
 * + relative); the Copy/Reveal actions need it, Find scopes by the relative path.
 */
import type { ReactNode } from 'react';
import type { FileTreeEntry } from '@/lib/api/files';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { showItemInFolder } from '@/lib/tauri/bridge';
import { writeToClipboard } from '@/lib/editor/copy-reference';

interface FileTreeRowMenuProps {
  entry: FileTreeEntry;
  /** Absolute on-disk path for Reveal/Copy Path; falls back to the relative path when no base is known. */
  fullPath: string;
  children: ReactNode;
}

export function FileTreeRowMenu({ entry, fullPath, children }: FileTreeRowMenuProps) {
  const isDir = entry.type === 'directory';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          data-testid={isDir ? 'file-tree-find-in-folder' : 'file-tree-find-in-file'}
          onSelect={() =>
            emitSurfaceIntent({
              type: 'open-find-in-path',
              scopePath: entry.path,
              scopeType: isDir ? 'directory' : 'file',
            })
          }
        >
          {isDir ? 'Find in folder' : 'Find in file'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="file-tree-reveal" onSelect={() => void showItemInFolder(fullPath)}>
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem data-testid="file-tree-copy-path" onSelect={() => void writeToClipboard(fullPath)}>
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem data-testid="file-tree-copy-relative-path" onSelect={() => void writeToClipboard(entry.path)}>
          Copy Relative Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
