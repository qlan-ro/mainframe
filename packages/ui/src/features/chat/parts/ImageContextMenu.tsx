'use client';

/**
 * ImageContextMenu — right-click an opened image to copy the bitmap itself.
 *
 * Mounts nothing when the source or the host can't be served (`canCopyImage`):
 * a one-item menu whose only item is dead is worse than no menu, and the
 * right-click falls through to the webview's own menu exactly as before.
 *
 * The trigger gets no `onContextMenu` guard, unlike `link-with-preview.tsx`.
 * This trigger nests inside `MessagePathContextMenu`, and React carries the
 * synthetic event through the Dialog portal to it — but the inner trigger runs
 * first and Radix's own handler ends with `preventDefault()`, which the outer
 * trigger honors via `checkForDefaultPrevented`, so the outer menu never opens.
 * The outer's own handler is inert here: it resolves paths through
 * `closest('[data-file-path]')`, and the lightbox image's DOM ancestry is the
 * portal on `document.body`, not the message.
 */
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, ContextMenuGroup } from '@v2/components/ui/context-menu';
import { CopyMenuItem } from '@/lib/ui/CopyMenuItem';
import { useMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { canCopyImage } from '@/lib/clipboard/image-source';
import { copyImageToClipboard } from '@/lib/clipboard/copy-image';
import { mfToast } from '@/lib/toast';

interface ImageContextMenuProps {
  src: string;
  children: ReactNode;
}

export function ImageContextMenu({ src, children }: ImageContextMenuProps) {
  const { statusFor, handleOpenChange, onCopySelect } = useMenuCopyFeedback();

  if (!canCopyImage(src)) return <>{children}</>;

  // No `await` before the call: WebKit only honors a clipboard write inside the
  // click's user activation.
  const handleCopy = async () => {
    const result = await copyImageToClipboard(src);
    if (!result.ok) mfToast.error('Could not copy the image', { description: result.message });
    return result.ok;
  };

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="image-context-menu" className="w-44">
        <ContextMenuGroup>
          <CopyMenuItem
            testId="image-copy"
            label="Copy Image"
            status={statusFor('image-copy')}
            onSelect={onCopySelect('image-copy', handleCopy)}
          />
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
