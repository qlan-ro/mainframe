/**
 * MessagePathContextMenu — wraps a message's rendered parts so right-clicking
 * a `[data-file-path]` pill (tool-card file paths) offers copy actions.
 *
 * The wrapper re-declares `flex flex-col gap-2` because GroupedParts renders
 * as a Fragment — without it, ContextMenuTrigger's single child would
 * collapse N flex siblings into one.
 *
 * Right-clicking anywhere else in the message (prose, a code block, a
 * selection) must fall through to the webview's OWN menu — Copy / Look Up /
 * Search are the only useful actions there, and this wrapper spans the whole
 * message. See `suppressRadixTrigger` for how that fall-through is kept.
 */
import { useState, type ReactNode } from 'react';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup } from '@/components/ui/context-menu';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { CopyMenuItem } from '@/lib/ui/CopyMenuItem';
import { writeToClipboard } from '@/lib/editor/copy-reference';
import { toFileRef } from '@/lib/files/file-ref';

/**
 * Stop Radix from opening this trigger WITHOUT stopping the native menu.
 *
 * `ContextMenuTrigger` runs its own handler through `composeEventHandlers`,
 * which skips it — the open AND the `event.preventDefault()` that kills the
 * webview's menu — only when the event is already default-prevented. Calling
 * `preventDefault()` ourselves would suppress the native menu too, leaving a
 * right-click on prose with no menu at all. Flipping the flag on the SYNTHETIC
 * event is precisely what React's own `preventDefault` does, minus the
 * `nativeEvent.preventDefault()` we must not make. (Radix has no controlled
 * `open`, and its `disabled` prop is read at render — too late to decide from
 * the event.) Pinned by the fall-through tests in this component's suite.
 */
function suppressRadixTrigger(event: React.MouseEvent): void {
  event.defaultPrevented = true;
}

export function MessagePathContextMenu({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string | null>(null);
  const bases = useActiveBasesStore((s) => s.bases);
  const { statusFor, handleOpenChange, onCopySelect } = useMenuCopyFeedback();

  const handleContextMenu = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-file-path]');
    const hasSelection = Boolean(window.getSelection()?.toString().trim());
    const next = hasSelection ? null : (el?.dataset.filePath ?? null);
    setPath(next);
    if (next == null) suppressRadixTrigger(e);
  };

  const ref = path != null ? toFileRef(path, bases) : null;
  const absolute = ref ? (ref.absolute ?? ref.relative) : '';
  const relative = ref?.relative ?? '';

  const copyAbsolute = onCopySelect('tool-card-path-copy-absolute', () => writeToClipboard(absolute));
  const copyRelative = onCopySelect('tool-card-path-copy-relative', () => writeToClipboard(relative));

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
        <div data-testid="chat-message-menu-trigger" className="flex flex-col gap-2">
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <CopyMenuItem
            testId="tool-card-path-copy-absolute"
            label="Copy Absolute Path"
            status={statusFor('tool-card-path-copy-absolute')}
            onSelect={copyAbsolute}
          />
          <CopyMenuItem
            testId="tool-card-path-copy-relative"
            label="Copy Relative Path"
            status={statusFor('tool-card-path-copy-relative')}
            onSelect={copyRelative}
          />
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
