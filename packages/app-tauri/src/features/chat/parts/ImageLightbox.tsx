'use client';

/**
 * ImageLightbox — a controlled multi-image gallery lightbox.
 *
 * The parent owns the open index (`null` = closed); this renders the current
 * image plus prev/next controls, a counter, and ArrowLeft/ArrowRight keyboard
 * nav (wrapping at the ends). Restores the desktop multi-image gallery
 * affordance that the single-image `ZoomableImage` didn't cover. Built on our
 * shadcn `Dialog` so no new dependency.
 *
 * For a single image the nav chrome is omitted (it degrades to a plain zoom).
 */
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export interface LightboxImage {
  src: string;
  alt?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  /** The open image index, or `null` when closed. */
  index: number | null;
  /** Called with the new index, or `null` to close. */
  onIndexChange: (index: number | null) => void;
}

function wrap(index: number, length: number): number {
  return (index + length) % length;
}

export function ImageLightbox({ images, index, onIndexChange }: ImageLightboxProps) {
  const open = index !== null;
  const hasNav = images.length > 1;

  const go = (delta: number) => {
    if (index === null) return;
    onIndexChange(wrap(index + delta, images.length));
  };

  useEffect(() => {
    if (!open || !hasNav) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `index` drives `go`; re-bind when it (or the set) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasNav, index, images.length]);

  if (index === null) return null;
  const current = images[index];
  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent
        data-testid="image-lightbox-dialog"
        className="max-w-[92vw] border-none bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>

        <img
          data-testid="image-lightbox-current"
          src={current.src}
          alt={current.alt ?? ''}
          className="mx-auto max-h-[88vh] max-w-full rounded-md object-contain"
        />

        {hasNav && (
          <>
            <button
              type="button"
              data-testid="image-lightbox-prev"
              aria-label="Previous image"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft size={20} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="image-lightbox-next"
              aria-label="Next image"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight size={20} aria-hidden />
            </button>
            <div
              data-testid="image-lightbox-counter"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-caption font-medium text-white"
            >
              {index + 1} / {images.length}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
