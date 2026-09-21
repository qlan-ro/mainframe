'use client';

/**
 * The file-reference anchor (#355, design-walk variant A): an inline
 * `aui-md-a` link with a leading `FileCode2` glyph, same prose rhythm as
 * `LinkWithPreview` but opening through the workspace instead of the OS
 * shell. Its context menu offers Open file + the two copy-path actions —
 * never "Copy link"/"Open link", and no hover Copy-URL tooltip.
 *
 * Renders outside the chat providers too (user message, plan bubble,
 * review-comment card, plan gate): only `useOpenFile` (bare `useCallback` +
 * `emitSurfaceIntent`) and `useActiveBasesStore` (a provider-less zustand
 * store) are used, both safe there.
 *
 * Port of the design-walk prototype (`prototype/design-walk-2026-09-20`,
 * `packages/ui/src/prototype/FileRefLink.tsx`) with the stubs replaced: no
 * `openStub`, `PROJECT` constant or `splitTarget` survive here.
 */
import type { AnchorHTMLAttributes, MouseEvent, ReactElement } from 'react';
import { FileCode2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { useMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { CopyMenuItem } from '@/lib/ui/CopyMenuItem';
import { writeToClipboard } from '@/lib/editor/copy-reference';
import { toFileRef } from '@/lib/files/file-ref';
import type { FileHrefTarget } from '@/lib/files/file-href';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useOpenFile } from '../tools/chat-tool-context';

const LINK_CLASS =
  'aui-md-a inline-flex items-center gap-1 border-b border-primary/40 text-primary no-underline hover:opacity-80 transition-opacity cursor-pointer';

interface FileRefLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  fileTarget: FileHrefTarget;
}

export function FileRefLink({ href, fileTarget, className, children, ...props }: FileRefLinkProps): ReactElement {
  const bases = useActiveBasesStore((s) => s.bases);
  const { openFile } = useOpenFile();
  const { statusFor, handleOpenChange, onCopySelect } = useMenuCopyFeedback();

  const ref = toFileRef(fileTarget.path, bases);
  const absolute = ref.absolute ?? ref.relative;
  const relative = ref.relative;
  const hasPosition = typeof fileTarget.line === 'number' && typeof fileTarget.character === 'number';
  const position = hasPosition
    ? { line: fileTarget.line as number, character: fileTarget.character as number }
    : undefined;

  const handleOpen = (e?: MouseEvent) => {
    e?.preventDefault();
    openFile(fileTarget.path, position);
  };

  const copyAbsoluteId = `chat-fileref-copy-absolute-${relative}`;
  const copyRelativeId = `chat-fileref-copy-relative-${relative}`;
  const copyAbsolute = onCopySelect(copyAbsoluteId, () => writeToClipboard(absolute));
  const copyRelative = onCopySelect(copyRelativeId, () => writeToClipboard(relative));

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
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
          className={cn(LINK_CLASS, className)}
        >
          <FileCode2 className="size-3 shrink-0" />
          {children}
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem data-testid={`chat-fileref-open-${relative}`} onSelect={() => handleOpen()}>
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
    </ContextMenu>
  );
}
