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
 *   path — file path used by ViewerShell for breadcrumb + reveal.
 *
 * Used by ViewerRouter after it reads the file as base64 and builds the URI.
 * data-testid="viewer-image" on the root element.
 */
import { useState } from 'react';
import { ZoomableImage } from '@/features/chat/parts/ZoomableImage';
import { ViewerShell } from './ViewerShell';
import { formatImageStatus } from './viewer-status';

interface ImageViewerProps {
  src: string | null;
  alt?: string;
  path: string;
}

interface ImgMeta {
  w: number;
  h: number;
  bytes: number;
}

function getExt(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'img') : 'img';
}

function base64ByteLength(src: string): number {
  const commaIdx = src.indexOf(',');
  if (commaIdx === -1) return 0;
  const b64 = src.slice(commaIdx + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function ImageViewer({ src, alt = '', path }: ImageViewerProps) {
  const [meta, setMeta] = useState<ImgMeta | null>(null);

  const ext = getExt(path);
  const status = meta
    ? formatImageStatus({ ext, w: meta.w, h: meta.h, bytes: meta.bytes })
    : `${ext.toUpperCase()} · Loading…`;

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const bytes = src ? base64ByteLength(src) : 0;
    setMeta({ w: img.naturalWidth, h: img.naturalHeight, bytes });
  }

  return (
    <ViewerShell path={path} status={status}>
      <div
        data-testid="viewer-image"
        className="relative flex h-full w-full flex-col items-center justify-center overflow-auto"
        style={{
          background:
            'repeating-conic-gradient(var(--mf-viewer-check-b) 0% 25%, var(--mf-viewer-check-a) 0% 50%) 0 0 / 18px 18px',
        }}
      >
        {src === null ? (
          <span className="text-body text-muted-foreground">Loading image…</span>
        ) : (
          <ZoomableImage
            src={src}
            alt={alt}
            className="max-h-[80vh] max-w-full rounded object-contain"
            onLoad={handleLoad}
          />
        )}
      </div>
    </ViewerShell>
  );
}
