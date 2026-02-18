import React from 'react';
import { FileText } from 'lucide-react';

export function ImageThumbs({
  imageBlocks,
  openLightbox,
}: {
  imageBlocks: { type: 'image'; mediaType: string; data: string }[];
  openLightbox: (images: { mediaType: string; data: string }[], index: number) => void;
}) {
  if (imageBlocks.length === 0) return null;
  return (
    <div className="flex gap-2 justify-end max-w-[75%] flex-wrap">
      {imageBlocks.map((img, i) => (
        <button
          key={i}
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
    <div className="flex gap-2 justify-end max-w-[75%] flex-wrap">
      {attachments.map((attachment, i) => (
        <div
          key={`${attachment.name}-${i}`}
          className="w-16 h-16 rounded overflow-hidden bg-mf-input-bg border border-mf-border flex flex-col items-center justify-center gap-1 px-1 text-mf-text-secondary"
        >
          <FileText size={14} />
          <span
            className="text-[9px] leading-tight w-full h-7 overflow-hidden text-center break-all"
            title={attachment.name}
          >
            {attachment.name}
          </span>
        </div>
      ))}
    </div>
  );
}
