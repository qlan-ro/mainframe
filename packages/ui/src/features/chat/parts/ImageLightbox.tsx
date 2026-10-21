'use client';

import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { LightboxSurface } from './LightboxSurface';

export interface LightboxImage {
  src?: string;
  alt?: string;
  error?: boolean;
  onRetry?: () => void;
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

  useGalleryKeys(index, images.length, onIndexChange);

  // Keep the closed dialog mounted so Radix can restore body pointer events.
  const current = index !== null ? images[index] : undefined;

  return (
    <Dialog open={open && current != null} onOpenChange={(o) => !o && onIndexChange(null)}>
      {current && (
        <LightboxSurface
          testId="image-lightbox-dialog"
          imageTestId="image-lightbox-current"
          src={current.src}
          error={current.error}
          onRetry={current.onRetry}
          alt={current.alt}
          onDismiss={() => onIndexChange(null)}
        >
          {hasNav && <GalleryNavigation index={index ?? 0} length={images.length} go={go} />}
        </LightboxSurface>
      )}
    </Dialog>
  );
}

function useGalleryKeys(index: number | null, length: number, onIndexChange: (index: number) => void) {
  useEffect(() => {
    if (index === null || length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      onIndexChange(wrap(index + (event.key === 'ArrowRight' ? 1 : -1), length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, length, onIndexChange]);
}

function GalleryNavigation({ index, length, go }: { index: number; length: number; go: (delta: number) => void }) {
  return (
    <>
      <GalleryArrow direction="prev" onClick={() => go(-1)} />
      <GalleryArrow direction="next" onClick={() => go(1)} />
      <div
        data-testid="image-lightbox-counter"
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white"
      >
        {index + 1} / {length}
      </div>
    </>
  );
}

function GalleryArrow({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const previous = direction === 'prev';
  const Icon = previous ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      data-testid={`image-lightbox-${direction}`}
      aria-label={previous ? 'Previous image' : 'Next image'}
      onClick={onClick}
      className={`absolute ${previous ? 'left-2' : 'right-2'} top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}
