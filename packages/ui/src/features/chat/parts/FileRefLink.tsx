'use client';

/**
 * The file-reference anchor (#355): a path in the link ink and mono, with no
 * glyph (T1d). It opens in the workspace editor. Its context menu offers Open
 * file and the two copy-path actions, never "Copy link"/"Open link".
 *
 * Renders outside the chat providers too (user message, plan bubble,
 * review-comment card, plan gate): only `useOpenFile` (bare `useCallback` +
 * `emitSurfaceIntent`) and `useActiveBasesStore` (a provider-less zustand
 * store) are used, both safe there.
 */
import type { AnchorHTMLAttributes, MouseEvent, ReactElement } from 'react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { useMenuCopyFeedback, type UseMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { CopyMenuItem } from '@/lib/ui/CopyMenuItem';
import { writeToClipboard } from '@/lib/editor/copy-reference';
import { toFileRef } from '@/lib/files/file-ref';
import type { FileHrefTarget } from '@/lib/files/file-href';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useOpenFile } from '../tools/chat-tool-context';
import { useLinkDragSelect } from './link-drag-select';

const LINK_CLASS = 'mf-link mf-link-mono rounded-sm font-mono focus-visible:focus-line';

interface FileRefMenuProps {
  relative: string;
  absolute: string;
  onOpen: () => void;
  copyFeedback: UseMenuCopyFeedback;
}

/** Open file + the two copy-path rows — split out to keep FileRefLink's render under 50 lines. */
function FileRefMenu({ relative, absolute, onOpen, copyFeedback }: FileRefMenuProps): ReactElement {
  const { statusFor, onCopySelect } = copyFeedback;
  const copyAbsoluteId = `chat-fileref-copy-absolute-${relative}`;
  const copyRelativeId = `chat-fileref-copy-relative-${relative}`;
  const copyAbsolute = onCopySelect(copyAbsoluteId, () => writeToClipboard(absolute));
  const copyRelative = onCopySelect(copyRelativeId, () => writeToClipboard(relative));

  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem data-testid={`chat-fileref-open-${relative}`} onSelect={onOpen}>
          <FolderOpen />
          Open file
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <CopyMenuItem
          testId={copyAbsoluteId}
          label="Copy absolute path"
          status={statusFor(copyAbsoluteId)}
          onSelect={copyAbsolute}
        />
        <CopyMenuItem
          testId={copyRelativeId}
          label="Copy relative path"
          status={statusFor(copyRelativeId)}
          onSelect={copyRelative}
        />
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}

interface FileRefLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  fileTarget: FileHrefTarget;
}

export function FileRefLink({ href, fileTarget, className, children, ...props }: FileRefLinkProps): ReactElement {
  const bases = useActiveBasesStore((s) => s.bases);
  const { openFile } = useOpenFile();
  const copyFeedback = useMenuCopyFeedback();
  const { onMouseDown, endedDrag } = useLinkDragSelect();

  const ref = toFileRef(fileTarget.path, bases);
  const absolute = ref.absolute ?? ref.relative;
  const relative = ref.relative;
  const hasPosition = typeof fileTarget.line === 'number' && typeof fileTarget.character === 'number';
  const position = hasPosition
    ? { line: fileTarget.line as number, character: fileTarget.character as number }
    : undefined;

  const handleOpen = (e?: MouseEvent) => {
    e?.preventDefault();
    if (e && endedDrag()) return;
    openFile(fileTarget.path, position);
  };

  return (
    <ContextMenu onOpenChange={copyFeedback.handleOpenChange}>
      {/* select-text overrides the trigger primitive's select-none: WebKit drops a
          user-select:none link from Cmd+C even while it is highlighted (#396). */}
      <ContextMenuTrigger asChild className="select-text">
        <a
          {...props}
          href={href}
          data-testid={`chat-fileref-${relative}`}
          data-file-path={fileTarget.path}
          onClick={handleOpen}
          // stopPropagation only — never preventDefault: a parent
          // MessagePathContextMenu composes its own trigger the same way
          // (see that component), and preventDefault here would suppress
          // THIS link's own menu too.
          onContextMenu={(e) => e.stopPropagation()}
          // A drag starting here selects text instead of dragging the link (#396).
          draggable={false}
          onMouseDown={onMouseDown}
          className={cn(LINK_CLASS, className)}
        >
          {children}
        </a>
      </ContextMenuTrigger>
      <FileRefMenu relative={relative} absolute={absolute} onOpen={() => handleOpen()} copyFeedback={copyFeedback} />
    </ContextMenu>
  );
}
