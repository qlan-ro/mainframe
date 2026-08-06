/**
 * A controlled gallery over the task's image attachments — the parent owns the
 * open index, `null` meaning closed.
 *
 * The shipped app splits this across `ImageLightbox` + `LightboxSurface` in the
 * chat feature and wraps the image in an `ImageContextMenu` (copy / save). That
 * menu is a chat surface and is not ported here; the gallery itself is small
 * enough on a stock `Dialog` to stand alone until the chat port claims it.
 */
import { useEffect } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@v2/components/ui/dialog';

export interface LightboxImage {
  src: string;
  alt?: string;
}

interface AttachmentLightboxProps {
  images: LightboxImage[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

interface NavButtonProps {
  testId: string;
  label: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}

function NavButton({ testId, label, className, onClick, children }: NavButtonProps) {
  return (
    <Button
      type="button"
      data-testid={testId}
      aria-label={label}
      size="icon"
      variant="secondary"
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full ${className}`}
    >
      {children}
    </Button>
  );
}

export function AttachmentLightbox({ images, index, onIndexChange }: AttachmentLightboxProps) {
  const hasNav = images.length > 1;

  useEffect(() => {
    if (index === null || !hasNav) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      onIndexChange(((index as number) + (e.key === 'ArrowRight' ? 1 : -1) + images.length) % images.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasNav, images.length, onIndexChange]);

  if (index === null) return null;
  const current = images[index];
  if (!current) return null;

  const go = (delta: number) => onIndexChange((index + delta + images.length) % images.length);

  return (
    <Dialog open onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogContent
        data-testid="image-lightbox-dialog"
        showCloseButton={false}
        onClick={(e) => e.target === e.currentTarget && onIndexChange(null)}
        className="max-w-[92vw] bg-transparent p-0 ring-0 sm:max-w-[92vw]"
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
            <NavButton testId="image-lightbox-prev" label="Previous image" className="left-2" onClick={() => go(-1)}>
              <ChevronLeftIcon />
            </NavButton>
            <NavButton testId="image-lightbox-next" label="Next image" className="right-2" onClick={() => go(1)}>
              <ChevronRightIcon />
            </NavButton>
            <div
              data-testid="image-lightbox-counter"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
            >
              {index + 1} / {images.length}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
