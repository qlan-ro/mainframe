/**
 * MessagePathContextMenu — wraps a message's rendered parts so right-clicking
 * a `[data-file-path]` pill (tool-card file paths) offers copy actions.
 *
 * The wrapper re-declares `flex flex-col gap-2` because GroupedParts renders
 * as a Fragment — without it, ContextMenuTrigger's single child would
 * collapse N flex siblings into one.
 */
import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { writeToClipboard } from '@/lib/editor/copy-reference';
import { toFileRef } from '@/lib/files/file-ref';

export function MessagePathContextMenu({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string | null>(null);
  const bases = useActiveBasesStore((s) => s.bases);
  const { copiedId, handleOpenChange, onCopySelect } = useMenuCopyFeedback();

  const handleContextMenu = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-file-path]');
    const hasSelection = Boolean(window.getSelection()?.toString().trim());
    setPath(hasSelection ? null : (el?.dataset.filePath ?? null));
  };

  const ref = path != null ? toFileRef(path, bases) : null;
  const absolute = ref ? (ref.absolute ?? ref.relative) : '';
  const relative = ref?.relative ?? '';

  const copyAbsolute = onCopySelect('tool-card-path-copy-absolute', () => {
    void writeToClipboard(absolute);
  });
  const copyRelative = onCopySelect('tool-card-path-copy-relative', () => {
    void writeToClipboard(relative);
  });

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
        <div data-testid="chat-message-menu-trigger" className="flex flex-col gap-2">
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {ref == null ? (
          <ContextMenuItem data-testid="chat-menu-empty" disabled>
            No actions available
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem data-testid="tool-card-path-copy-absolute" onSelect={copyAbsolute}>
              {copiedId === 'tool-card-path-copy-absolute' ? (
                <Check className="mr-2 size-3.5 text-mf-success" />
              ) : (
                <Copy className="mr-2 size-3.5" />
              )}
              {copiedId === 'tool-card-path-copy-absolute' ? 'Copied' : 'Copy Absolute Path'}
            </ContextMenuItem>
            <ContextMenuItem data-testid="tool-card-path-copy-relative" onSelect={copyRelative}>
              {copiedId === 'tool-card-path-copy-relative' ? (
                <Check className="mr-2 size-3.5 text-mf-success" />
              ) : (
                <Copy className="mr-2 size-3.5" />
              )}
              {copiedId === 'tool-card-path-copy-relative' ? 'Copied' : 'Copy Relative Path'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
