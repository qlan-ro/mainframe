'use client';

/**
 * Click-to-zoom inline image. Restores the desktop affordance (clicking an
 * in-message image opened a lightbox) that the bare `<img>` port had lost.
 *
 * Single-image zoom only — the native `MessagePartPrimitive.Image` is a bare
 * `<img>` with no zoom, and the inventory decided single-image in-message zoom
 * can go native/shadcn (the multi-image gallery lightbox stays a separate
 * keep-ours). The dialog shell, image, and click-to-dismiss behavior live in
 * `LightboxSurface`.
 */
import { useState } from 'react';
import { Dialog, DialogTrigger } from '@v2/components/ui/dialog';
import { LightboxSurface } from './LightboxSurface';

interface ZoomableImageProps {
  src: string;
  alt?: string;
  /** Classes for the thumbnail `<img>` (size/shape/border per call site). */
  className?: string;
  /** Forwarded to the thumbnail `<img>` so callers can detect natural dimensions. */
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
}

export function ZoomableImage({ src, alt = '', className, onLoad }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="chat-image-zoom-trigger"
          aria-label="View image full size"
          className="block cursor-zoom-in rounded-[inherit] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src={src} alt={alt} className={className} onLoad={onLoad} />
        </button>
      </DialogTrigger>
      <LightboxSurface
        testId="chat-image-zoom-dialog"
        imageTestId="chat-image-zoom-image"
        src={src}
        alt={alt}
        onDismiss={() => setOpen(false)}
      />
    </Dialog>
  );
}
