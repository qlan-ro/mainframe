'use client';

/**
 * ImageViewer.tsx
 *
 * Renders a raster image (png/jpg/gif/webp) with:
 *   - The shared `checkerStyle` transparency backdrop (mf-viewer-check-a/b, 18px tile).
 *   - A theme-aware mount card behind the image (bg-background + shadow-md).
 *   - Fit/100% segmented toggle in the ViewerShell header actions slot.
 *   - Zoom in/out buttons (disabled in Fit mode) in the actions slot.
 *   - statusRight with file size and zoom level.
 *   - Click-to-zoom via ZoomableImage (Fit mode only — acts as quick preview trigger).
 *
 * Props:
 *   src  — data URI (data:image/…;base64,…) or any URL; null while loading.
 *   alt  — alt text forwarded to the img element.
 *   path — file path used by ViewerShell for breadcrumb + reveal.
 *
 * data-testid="viewer-image" on the root element.
 */
import { useState } from 'react';
import { ZoomOut, ZoomIn, Maximize2 } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { ZoomableImage } from '@/features/chat/parts/ZoomableImage';
import { ViewerShell } from './ViewerShell';
import { Segmented } from './Segmented';
import { checkerStyle } from './viewer-checker';
import { splitImageStatus } from './viewer-status';

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

type FitMode = 'fit' | 'actual';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

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
  const [fitMode, setFitMode] = useState<FitMode>('fit');
  const [zoom, setZoom] = useState(1);

  const ext = getExt(path);
  const isFit = fitMode === 'fit';

  const { left: statusLeft, right: statusRight } = meta
    ? splitImageStatus({ ext, w: meta.w, h: meta.h, bytes: meta.bytes, zoom, fit: isFit })
    : { left: `${ext.toUpperCase()} · Loading…`, right: '' };

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const bytes = src ? base64ByteLength(src) : 0;
    setMeta({ w: img.naturalWidth, h: img.naturalHeight, bytes });
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  }

  function handleFitToggle(mode: FitMode) {
    setFitMode(mode);
    if (mode === 'actual') setZoom(1);
  }

  // Header controls: zoom out, zoom in, Fit/100% segmented toggle.
  const actions = (
    <div className="flex items-center gap-1">
      <Hint label="Zoom out">
        <Button
          data-testid="viewer-image-zoom-out"
          variant="ghost"
          size="icon-xs"
          disabled={isFit}
          onClick={handleZoomOut}
        >
          <ZoomOut aria-hidden />
        </Button>
      </Hint>
      <Hint label="Zoom in">
        <Button
          data-testid="viewer-image-zoom-in"
          variant="ghost"
          size="icon-xs"
          disabled={isFit}
          onClick={handleZoomIn}
        >
          <ZoomIn aria-hidden />
        </Button>
      </Hint>
      <Segmented
        value={fitMode}
        onChange={(id) => handleFitToggle(id as FitMode)}
        options={[
          { id: 'fit', label: 'Fit', icon: <Maximize2 aria-hidden />, testId: 'viewer-image-fit-toggle' },
          { id: 'actual', label: '100%', testId: 'viewer-image-actual-toggle' },
        ]}
      />
    </div>
  );

  return (
    <ViewerShell path={path} status={statusLeft} statusRight={statusRight || undefined} actions={actions}>
      <div
        data-testid="viewer-image"
        className="relative flex h-full w-full items-center justify-center overflow-auto p-7"
        style={checkerStyle}
      >
        {src === null ? (
          <span className="text-sm text-muted-foreground">Loading image…</span>
        ) : (
          <div
            className="relative overflow-hidden bg-background shadow-md"
            style={isFit ? { maxWidth: '86%', flexShrink: 0 } : { width: meta ? meta.w * zoom : 'auto', flexShrink: 0 }}
          >
            <ZoomableImage src={src} alt={alt} className="block w-full h-auto object-contain" onLoad={handleLoad} />
          </div>
        )}
      </div>
    </ViewerShell>
  );
}
