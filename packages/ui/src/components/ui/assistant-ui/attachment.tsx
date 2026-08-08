'use client';

/**
 * aui attachment adapters — the two seams both attachment surfaces need from
 * assistant-ui, with no chrome of their own.
 *
 * The tiles live in the features: `features/chat/messages/UserAttachments.tsx`
 * (sent turn) and `features/chat/composer/attachments/ComposerAttachmentStrip.tsx`
 * (pending). Both render the v2 chat kit's `Attachment` compound; the
 * hand-rolled Avatar thumbnail this file used to own is gone.
 */

import { type PropsWithChildren, useEffect, useState, type FC } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useShallow } from 'zustand/react/shallow';
import { Dialog, DialogTitle, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Object-URL lifecycle for local File objects ───────────────────────────────
const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

// ── Resolve the image src from the attachment context ────────────────────────
export const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== 'image') return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const imageSrc = s.attachment.content?.filter((c) => c.type === 'image')[0]?.image;
      if (!imageSrc) return {};
      return { src: imageSrc };
    }),
  );
  return useFileSrc(file) ?? src;
};

// ── Full-resolution image inside the preview dialog ──────────────────────────
type AttachmentPreviewProps = { src: string };

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt="Attachment preview"
      className={cn('mx-auto max-h-[88vh] max-w-full rounded-md object-contain', isLoaded ? '' : 'invisible')}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

// ── Dialog that wraps the tile; skipped for non-image attachments ─────────────
export const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();
  if (!src) return <>{children}</>;

  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer transition-opacity hover:opacity-80" asChild>
        {children}
      </DialogTrigger>
      {/* Bare-frame variant, the same one the chat lightboxes use: the image IS
          the dialog, so the panel chrome is stripped and only the stock close
          button and the scrim remain. */}
      <DialogContent className="max-w-[92vw] rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-w-[92vw]">
        <DialogTitle className="sr-only">Image attachment preview</DialogTitle>
        <AttachmentPreview src={src} />
      </DialogContent>
    </Dialog>
  );
};
