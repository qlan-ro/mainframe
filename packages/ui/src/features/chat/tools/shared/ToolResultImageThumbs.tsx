/**
 * ToolResultImageThumbs — thumbnail row for tool-result images (todo #363).
 *
 * Reuses the production `Attachment`/`AttachmentMedia`/`AttachmentTrigger`
 * primitive (the same one `UserAttachments`' bare `ImageAttachment` tile
 * uses) rather than inventing new chrome, and `ImageLightbox` for the
 * expand-to-fullsize gallery. Confirmed clean in the design-walk prototype
 * (branch `prototype/design-walk-2026-09-23`, commit `c58beeec`, never
 * merged).
 *
 * State comes straight from `<img onLoad/onError>`, mapped onto the
 * primitive's existing `state` prop: pending → 'processing' (dim), loaded →
 * 'done' (full opacity, click-to-zoom), failed → 'error' (destructive tint,
 * `ImageOffIcon`, no trigger — nothing to zoom into).
 *
 * Callers (`ReadFileCard`, the fallback tool card, `MCPToolCard`) mount this
 * in a card header that itself may carry a click/keydown toggle, so the
 * trigger's own handlers stop propagation — a click here must never expand
 * or collapse the card.
 */
import { useState } from 'react';
import { ImageOffIcon } from 'lucide-react';
import type { ToolResultImage } from '@qlan-ro/mainframe-types';
import { Attachment, AttachmentMedia, AttachmentTrigger } from '@/components/ui/attachment';
import { ImageLightbox } from '../../parts/ImageLightbox';

type ThumbState = 'pending' | 'done' | 'error';

function dataUrl(image: ToolResultImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

interface ThumbProps {
  image: ToolResultImage;
  testId: string;
  onOpen: () => void;
}

function ToolResultImageThumb({ image, testId, onOpen }: ThumbProps) {
  const [state, setState] = useState<ThumbState>('pending');

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    }
  };

  return (
    <Attachment
      data-testid={testId}
      state={state === 'pending' ? 'processing' : state}
      size="xs"
      className="min-w-0 border-0 bg-transparent has-data-[slot=attachment-media]:p-0"
    >
      {state === 'done' && (
        <AttachmentTrigger aria-label="Open image" onClick={handleClick} onKeyDown={handleKeyDown} />
      )}
      <AttachmentMedia variant="image">
        {state === 'error' ? (
          <ImageOffIcon className="size-3.5 text-destructive" />
        ) : (
          <img src={dataUrl(image)} alt="" onLoad={() => setState('done')} onError={() => setState('error')} />
        )}
      </AttachmentMedia>
    </Attachment>
  );
}

export interface ToolResultImageThumbsProps {
  toolCallId: string;
  images: ToolResultImage[];
}

/** Renders nothing when `images` is empty, so callers can pass it unconditionally. */
export function ToolResultImageThumbs({ toolCallId, images }: ToolResultImageThumbsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {images.map((image, index) => (
        <ToolResultImageThumb
          key={index}
          image={image}
          testId={`tool-result-image-${toolCallId}-${index}`}
          onOpen={() => setOpenIndex(index)}
        />
      ))}
      <ImageLightbox
        images={images.map((image) => ({ src: dataUrl(image) }))}
        index={openIndex}
        onIndexChange={setOpenIndex}
      />
    </div>
  );
}
