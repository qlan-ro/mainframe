import { FileText } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../ui/tooltip';

export function ImageThumbs({
  imageBlocks,
  openLightbox,
}: {
  imageBlocks: { type: 'image'; mediaType: string; data: string }[];
  openLightbox: (images: { mediaType: string; data: string }[], index: number) => void;
}) {
  if (imageBlocks.length === 0) return null;
  return (
    <div className="flex gap-2 max-w-[75%] flex-wrap w-fit">
      {imageBlocks.map((img, i) => (
        <button
          key={i}
          data-testid="message-image-thumb"
          onClick={() => openLightbox(imageBlocks, i)}
          className="w-16 h-16 rounded overflow-hidden hover:ring-2 hover:ring-mf-accent transition-all"
        >
          <img
            src={`data:${img.mediaType};base64,${img.data}`}
            alt={`Attached image ${i + 1}`}
            className="w-full h-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

export function FileAttachmentThumbs({ attachments }: { attachments: { name: string }[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex gap-2 max-w-[75%] flex-wrap w-fit">
      {attachments.map((attachment, i) => (
        <div
          key={`${attachment.name}-${i}`}
          className="w-16 h-16 rounded overflow-hidden bg-mf-input-bg border border-mf-border flex flex-col items-center justify-center gap-1 px-1 text-mf-text-secondary"
        >
          <FileText size={14} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[9px] leading-tight w-full h-7 overflow-hidden text-center break-all" tabIndex={0}>
                {attachment.name}
              </span>
            </TooltipTrigger>
            <TooltipContent>{attachment.name}</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
