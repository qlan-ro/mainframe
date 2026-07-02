'use client';

import { type PropsWithChildren, useEffect, useState, type FC } from 'react';
import { AtSignIcon, XIcon, Paperclip, FileText } from 'lucide-react';
import { AttachmentPrimitive, ComposerPrimitive, MessagePrimitive, useAuiState, useAui } from '@assistant-ui/react';
import { useShallow } from 'zustand/react/shallow';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogTitle, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { TooltipIconButton } from '@/components/ui/assistant-ui/tooltip-icon-button';
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
      className={cn('block h-auto max-h-[80vh] w-auto max-w-full object-contain', isLoaded ? '' : 'invisible')}
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
      <DialogTrigger className="cursor-pointer transition-colors hover:opacity-80" asChild>
        {children}
      </DialogTrigger>
      {/* Warm-chrome dialog: bg-card, compact padding, round close button */}
      <DialogContent
        className={cn(
          'p-2 sm:max-w-3xl',
          '[&>button]:rounded-full [&>button]:bg-card [&>button]:p-1',
          '[&>button]:opacity-100 [&>button]:ring-0!',
          '[&>button_svg]:text-foreground',
          '[&>button:hover_svg]:text-destructive',
        )}
      >
        <DialogTitle className="sr-only">Image Attachment Preview</DialogTitle>
        <div className="relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden bg-background">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Thumbnail inside the tile ─────────────────────────────────────────────────
const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();
  return (
    <Avatar className="h-full w-full rounded-none">
      <AvatarImage src={src} alt="Attachment" className="object-cover" />
      <AvatarFallback className="rounded-none bg-mf-raised">
        <FileText className="size-8 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );
};

// ── Remove button — quiet warm-chrome circle ──────────────────────────────────
const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        data-testid="composer-attachment-remove"
        tooltip="Remove file"
        side="top"
        className={cn(
          'absolute end-1.5 top-1.5 size-3.5 rounded-full',
          'bg-card opacity-100 shadow-sm',
          'text-foreground hover:bg-card!',
          '[&_svg]:text-foreground hover:[&_svg]:text-destructive',
        )}
      >
        <XIcon className="size-3" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

// ── Single attachment tile (composer or message) ──────────────────────────────
const AttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== 'message';
  const isImage = useAuiState((s) => s.attachment.type === 'image');
  const typeLabel = useAuiState((s) => {
    const type = s.attachment.type;
    if (type === 'image') return 'Image';
    if (type === 'document') return 'Document';
    if (type === 'file') return 'File';
    return String(type);
  });

  return (
    <Tooltip>
      <AttachmentPrimitive.Root className={cn('relative', isImage && 'only:*:first:size-24')}>
        <AttachmentPreviewDialog>
          <TooltipTrigger asChild>
            <div
              data-testid="composer-attachment-tile"
              className={cn(
                'size-14 cursor-pointer overflow-hidden rounded-lg border border-border',
                'bg-mf-raised transition-opacity hover:opacity-75',
              )}
              role="button"
              tabIndex={0}
              aria-label={`${typeLabel} attachment`}
            >
              <AttachmentThumb />
            </div>
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

// ── Composer attachments row — empty:hidden via CSS ───────────────────────────
export const ComposerAttachments: FC = () => {
  return (
    <div className="flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>{() => <AttachmentUI />}</ComposerPrimitive.Attachments>
    </div>
  );
};

// ── Add-attachment button — paperclip, warm-chrome toolbar sizing ─────────────
export const ComposerAddAttachment: FC = () => {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <TooltipIconButton
        data-testid="composer-add-attachment"
        tooltip="Add Attachment"
        side="bottom"
        variant="ghost"
        size="icon"
        aria-label="Add Attachment"
        onMouseDown={(e) => e.preventDefault()}
        className="size-[22px] rounded-sm p-1 text-mf-text-3 hover:text-foreground"
      >
        <Paperclip className="size-3 stroke-[1.5px]" />
      </TooltipIconButton>
    </ComposerPrimitive.AddAttachment>
  );
};

// ── Add-mention button — dedicated "@" toolbar affordance (mirrors the design's
//    second gActionStyle icon button, sitting beside the paperclip). Clicking it
//    appends "@" to the composer text, which opens the native `@` mention trigger
//    popover (ComposerTriggers) the same way typing "@" does. ─────────────────
export const ComposerAddMention: FC = () => {
  const aui = useAui();
  const handleClick = () => {
    const composer = aui.composer();
    const text = composer.getState().text;
    composer.setText(text.length > 0 && !text.endsWith(' ') ? `${text} @` : `${text}@`);
  };

  return (
    <TooltipIconButton
      data-testid="composer-add-mention"
      tooltip="Mention a file or agent"
      side="bottom"
      variant="ghost"
      size="icon"
      aria-label="Mention a file or agent"
      onClick={handleClick}
      onMouseDown={(e) => e.preventDefault()}
      className="size-[22px] rounded-sm p-1 text-mf-text-3 hover:text-foreground"
    >
      <AtSignIcon className="size-3 stroke-[1.5px]" />
    </TooltipIconButton>
  );
};

// ── User message attachments (for display in thread) ─────────────────────────
export const UserMessageAttachments: FC = () => {
  return (
    <div className="col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>{() => <AttachmentUI />}</MessagePrimitive.Attachments>
    </div>
  );
};
