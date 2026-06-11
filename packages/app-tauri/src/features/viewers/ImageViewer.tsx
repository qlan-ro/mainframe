'use client';

/**
 * ImageViewer.tsx
 *
 * Renders a raster image (png/jpg/gif/webp) with a checkerboard transparency
 * backdrop and click-to-zoom via the existing ZoomableImage dialog.
 *
 * Props:
 *   src  — data URI (data:image/…;base64,…) or any URL; null while loading.
 *   alt  — alt text forwarded to the img element.
 *
 * Used by ViewerRouter after it reads the file as base64 and builds the URI.
 * data-testid="viewer-image" on the root element.
 */
import { ZoomableImage } from '@/features/chat/parts/ZoomableImage';

interface ImageViewerProps {
  src: string | null;
  alt?: string;
}

export function ImageViewer({ src, alt = '' }: ImageViewerProps) {
  return (
    <div
      data-testid="viewer-image"
      className="relative flex h-full w-full flex-col items-center justify-center overflow-auto"
      style={{
        background: 'var(--mf-checkerboard, repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 0 0 / 16px 16px)',
      }}
    >
      {src === null ? (
        <span className="text-sm text-mf-text-secondary">Loading image…</span>
      ) : (
        <ZoomableImage src={src} alt={alt} className="max-h-[80vh] max-w-full rounded object-contain" />
      )}
    </div>
  );
}
