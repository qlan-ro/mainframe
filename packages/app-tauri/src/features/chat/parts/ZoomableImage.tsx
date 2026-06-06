'use client';

/**
 * Click-to-zoom inline image. Restores the desktop affordance (clicking an
 * in-message image opened a lightbox) that the bare `<img>` port had lost.
 *
 * Single-image zoom only — the native `MessagePartPrimitive.Image` is a bare
 * `<img>` with no zoom, and the inventory decided single-image in-message zoom
 * can go native/shadcn (the multi-image gallery lightbox stays a separate
 * keep-ours). Built on our existing shadcn `Dialog` so no new dependency.
 */
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface ZoomableImageProps {
  src: string;
  alt?: string;
  /** Classes for the thumbnail `<img>` (size/shape/border per call site). */
  className?: string;
}

export function ZoomableImage({ src, alt = '', className }: ZoomableImageProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="chat-image-zoom-trigger"
          aria-label="View image full size"
          className="block cursor-zoom-in rounded-[inherit] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src={src} alt={alt} className={className} />
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid="chat-image-zoom-dialog"
        className="max-w-[92vw] border-none bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <img src={src} alt={alt} className="mx-auto max-h-[88vh] max-w-full rounded-md object-contain" />
      </DialogContent>
    </Dialog>
  );
}
