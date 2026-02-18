import React from 'react';
import { X } from 'lucide-react';
import { AttachmentPrimitive, useAttachment } from '@assistant-ui/react';

export function ImageAttachmentPreview() {
  const attachment = useAttachment();
  const imageContent = attachment.content?.find((c: { type: string }) => c.type === 'image') as
    | { type: 'image'; image: string }
    | undefined;

  return (
    <AttachmentPrimitive.Root className="relative group w-14 h-14">
      {imageContent ? (
        <img
          src={imageContent.image}
          alt={attachment.name}
          className="w-full h-full rounded overflow-hidden object-cover"
        />
      ) : (
        <div className="w-full h-full rounded bg-mf-hover flex items-center justify-center text-mf-small text-mf-text-secondary">
          {attachment.name?.split('.').pop()}
        </div>
      )}
      <AttachmentPrimitive.Remove className="absolute -top-1 -right-1 w-4 h-4 bg-mf-text-primary rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <X size={10} className="text-mf-panel-bg" />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}
