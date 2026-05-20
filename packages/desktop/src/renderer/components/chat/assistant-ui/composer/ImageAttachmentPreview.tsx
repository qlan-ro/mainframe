import { X } from 'lucide-react';
import { AttachmentPrimitive, useAttachment } from '@assistant-ui/react';
import { useMainframeRuntime } from '../MainframeRuntimeProvider';

function stripExt(name: string | undefined): string {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function ImageAttachmentPreview() {
  const attachment = useAttachment();
  const { openLightbox } = useMainframeRuntime();
  const imageContent = attachment.content?.find((c: { type: string }) => c.type === 'image') as
    | { type: 'image'; image: string }
    | undefined;

  const handleClick = () => {
    if (!imageContent) return;
    const match = imageContent.image.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    openLightbox([{ mediaType: match[1]!, data: match[2]! }], 0);
  };

  const caption = stripExt(attachment.name);

  return (
    <AttachmentPrimitive.Root className="relative group flex flex-col items-center gap-1 w-14">
      <div className="relative w-14 h-14">
        {imageContent ? (
          <button
            type="button"
            data-testid="attachment-thumb"
            onClick={handleClick}
            className="w-full h-full rounded overflow-hidden border border-mf-border"
          >
            <img src={imageContent.image} alt={attachment.name} className="w-full h-full object-cover" />
          </button>
        ) : (
          <div className="w-full h-full rounded bg-mf-hover border border-mf-border flex items-center justify-center text-mf-small text-mf-text-secondary">
            {attachment.name?.split('.').pop()}
          </div>
        )}
        <AttachmentPrimitive.Remove
          aria-label="Remove"
          className="absolute -top-1 -right-1 w-4 h-4 bg-mf-text-primary rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={10} className="text-mf-panel-bg" />
        </AttachmentPrimitive.Remove>
      </div>
      {caption ? (
        <span
          data-testid="attachment-name"
          className="text-[10px] font-mono text-mf-text-secondary truncate max-w-full"
          title={attachment.name}
        >
          {caption}
        </span>
      ) : null}
    </AttachmentPrimitive.Root>
  );
}
