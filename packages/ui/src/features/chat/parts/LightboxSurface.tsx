'use client';

import { useRef, type MouseEvent, type ReactNode } from 'react';
import { DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ImageContextMenu } from './ImageContextMenu';

interface LightboxSurfaceProps {
  testId: string;
  imageTestId: string;
  src: string;
  alt?: string;
  onDismiss: () => void;
  /** Nav chrome drawn over the image (absolutely positioned by the caller). */
  children?: ReactNode;
}

export function LightboxSurface({ testId, imageTestId, src, alt = '', onDismiss, children }: LightboxSurfaceProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  // Nav chrome and the close button live inside this box, so dismiss only for
  // clicks that land on the box itself or the image — never on a control.
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget || event.target === imageRef.current) onDismiss();
  };

  return (
    <DialogContent
      data-testid={testId}
      onClick={handleClick}
      className="max-w-[92vw] border-none bg-transparent p-0 shadow-none"
    >
      <DialogTitle className="sr-only">Image preview</DialogTitle>
      <ImageContextMenu src={src}>
        <img
          ref={imageRef}
          data-testid={imageTestId}
          src={src}
          alt={alt}
          className="mx-auto max-h-[88vh] max-w-full rounded-md object-contain"
        />
      </ImageContextMenu>
      {children}
    </DialogContent>
  );
}
