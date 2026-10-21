import { useState } from 'react';
import { ImageOffIcon } from 'lucide-react';
import type { ToolResultImage } from '@qlan-ro/mainframe-types';
import { Attachment, AttachmentMedia, AttachmentTrigger } from '@/components/ui/attachment';
import { ImageLightbox } from '../../parts/ImageLightbox';
import { useToolImage, useImageResolution, toolImageDataUrl, type ResolvedToolImage } from './use-tool-image';

type ThumbState = 'pending' | 'done' | 'error';

interface ThumbProps {
  image: ToolResultImage;
  testId: string;
  onOpen: () => void;
  active: boolean;
  onResolve: (uri: string, value: ResolvedToolImage) => void;
  onRetry: () => void;
}

function ToolResultImageThumb({ image, testId, onOpen, active, onResolve, onRetry }: ThumbProps) {
  const [state, setState] = useState<ThumbState>('pending');
  const { ref, src, error } = useToolImage(image, active, onResolve);
  const failed = error || state === 'error';
  const activate = failed ? onRetry : onOpen;

  return (
    <Attachment
      ref={ref}
      data-testid={testId}
      state={error ? 'error' : state === 'pending' ? 'processing' : state}
      size="xs"
      className="min-w-0 border-0 bg-transparent has-data-[slot=attachment-media]:p-0"
    >
      {(state === 'done' || failed) && <ImageTrigger failed={!!failed} activate={activate} />}
      <AttachmentMedia variant="image">
        {error || state === 'error' ? (
          <ImageOffIcon className="size-3.5 text-destructive" />
        ) : (
          <img src={src} alt="" onLoad={() => setState('done')} onError={() => setState('error')} />
        )}
      </AttachmentMedia>
    </Attachment>
  );
}

function ImageTrigger({ failed, activate }: { failed: boolean; activate: () => void }) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    activate();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      activate();
    }
  };

  return (
    <AttachmentTrigger
      aria-label={failed ? 'Retry image' : 'Open image'}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    />
  );
}

export interface ToolResultImageThumbsProps {
  toolCallId: string;
  images: ToolResultImage[];
}

/** Renders nothing when `images` is empty, so callers can pass it unconditionally. */
export function ToolResultImageThumbs({ toolCallId, images }: ToolResultImageThumbsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { resolved, attempts, onResolve, retry } = useImageResolution(images);
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {images.map((image, index) => (
        <ToolResultImageThumb
          key={`${image.uri ?? index}:${attempts[index] ?? 0}`}
          image={image}
          testId={`tool-result-image-${toolCallId}-${index}`}
          onOpen={() => setOpenIndex(index)}
          active={openIndex === index}
          onResolve={onResolve}
          onRetry={() => retry(index)}
        />
      ))}
      <ImageLightbox
        images={images.map((image, index) => ({
          src: toolImageDataUrl(image) ?? (image.uri ? resolved[image.uri]?.src : undefined),
          error: image.uri ? resolved[image.uri]?.error : false,
          onRetry: () => retry(index),
        }))}
        index={openIndex}
        onIndexChange={setOpenIndex}
      />
    </div>
  );
}
