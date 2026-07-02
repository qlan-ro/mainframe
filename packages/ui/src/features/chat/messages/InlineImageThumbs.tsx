/**
 * InlineImageThumbs — regular (non-attachment) image parts on a user turn,
 * rendered as a right-aligned zoomable thumbnail row. Extracted from
 * UserMessage.tsx to keep it under the 300-line file budget.
 */
import { useState } from 'react';
import { ImageLightbox } from '../parts/ImageLightbox';

interface InlineImageThumbsProps {
  parts: Array<{ type: 'image'; image: string }>;
}

export function InlineImageThumbs({ parts }: InlineImageThumbsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {parts.map((p, i) => (
        <button
          key={p.image}
          type="button"
          data-testid="chat-image-zoom-trigger"
          aria-label="View image full size"
          onClick={() => setOpenIndex(i)}
          className="block cursor-zoom-in rounded-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={p.image}
            alt=""
            className="size-16 rounded-[11px] border-[0.5px] border-border object-cover shadow-sm"
          />
        </button>
      ))}
      <ImageLightbox images={parts.map((p) => ({ src: p.image }))} index={openIndex} onIndexChange={setOpenIndex} />
    </div>
  );
}
