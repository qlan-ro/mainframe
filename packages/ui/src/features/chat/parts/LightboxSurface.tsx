'use client';

import { useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ImageContextMenu } from './ImageContextMenu';
import { ImageOffIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LightboxSurfaceProps {
  testId: string;
  imageTestId: string;
  src?: string;
  error?: boolean;
  onRetry?: () => void;
  alt?: string;
  onDismiss: () => void;
  /** Nav chrome drawn over the image (absolutely positioned by the caller). */
  children?: ReactNode;
}

export function LightboxSurface({
  testId,
  imageTestId,
  src,
  error,
  onRetry,
  alt = '',
  onDismiss,
  children,
}: LightboxSurfaceProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget || event.target === imageRef.current) onDismiss();
  };

  return (
    <DialogContent
      data-testid={testId}
      onClick={handleClick}
      className="max-w-[92vw] rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-w-[92vw]"
    >
      <DialogTitle className="sr-only">Image preview</DialogTitle>
      <ImageContent src={src} imageRef={imageRef} imageTestId={imageTestId} alt={alt} error={error} onRetry={onRetry} />
      {children}
    </DialogContent>
  );
}

function ImageContent({
  src,
  imageRef,
  imageTestId,
  alt,
  error,
  onRetry,
}: {
  src?: string;
  imageRef: RefObject<HTMLImageElement | null>;
  imageTestId: string;
  alt?: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  return src ? (
    <ImageContextMenu src={src}>
      <img
        ref={imageRef}
        data-testid={imageTestId}
        src={src}
        alt={alt}
        className="mx-auto max-h-[88vh] max-w-full rounded-md object-contain"
      />
    </ImageContextMenu>
  ) : (
    <div
      role="status"
      aria-label={error ? 'Image unavailable' : 'Loading image'}
      className="flex min-h-32 flex-col items-center justify-center gap-2 text-muted-foreground"
    >
      {error ? <ImageOffIcon className="size-6" /> : <Loader2 className="size-6 animate-spin" />}
      {error && onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry image
        </Button>
      )}
    </div>
  );
}
