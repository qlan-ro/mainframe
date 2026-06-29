'use client';

/**
 * ImageViewer.tsx
 *
 * Renders a raster image (png/jpg/gif/webp) with:
 *   - A checkerboard transparency backdrop (warm mf-viewer-check-a/b tokens, 18px tile).
 *   - White shadow card behind the image (bg-white with pop shadow).
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
import { Hint } from '@/components/ui/hint';
import { ZoomableImage } from '@/features/chat/parts/ZoomableImage';
import { ViewerShell } from './ViewerShell';
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

const SEG_BTN = 'rounded-sm px-1.5 py-0.5 text-caption font-medium transition-colors';
const SEG_ACTIVE = 'bg-background text-foreground shadow-[var(--mf-shadow-segment)]';
const SEG_IDLE = 'text-mf-text-3 hover:text-foreground';

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
        <button
          type="button"
          data-testid="viewer-image-zoom-out"
          disabled={isFit}
          onClick={handleZoomOut}
          className="inline-flex h-5 w-[22px] shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-40"
        >
          <ZoomOut size={12} aria-hidden />
        </button>
      </Hint>
      <Hint label="Zoom in">
        <button
          type="button"
          data-testid="viewer-image-zoom-in"
          disabled={isFit}
          onClick={handleZoomIn}
          className="inline-flex h-5 w-[22px] shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-40"
        >
          <ZoomIn size={12} aria-hidden />
        </button>
      </Hint>
      <div className="inline-flex items-center gap-px rounded-md bg-mf-chip p-0.5">
        <button
          type="button"
          data-testid="viewer-image-fit-toggle"
          aria-pressed={isFit}
          onClick={() => handleFitToggle('fit')}
          className={`${SEG_BTN} inline-flex items-center gap-[4px] ${isFit ? SEG_ACTIVE : SEG_IDLE}`}
        >
          <Maximize2 size={11} aria-hidden />
          Fit
        </button>
        <button
          type="button"
          data-testid="viewer-image-actual-toggle"
          aria-pressed={!isFit}
          onClick={() => handleFitToggle('actual')}
          className={`${SEG_BTN} ${!isFit ? SEG_ACTIVE : SEG_IDLE}`}
        >
          100%
        </button>
      </div>
    </div>
  );

  return (
    <ViewerShell path={path} status={statusLeft} statusRight={statusRight || undefined} actions={actions}>
      <div
        data-testid="viewer-image"
        className="relative flex h-full w-full items-center justify-center overflow-auto p-[28px]"
        style={{
          backgroundColor: 'var(--mf-viewer-check-a)',
          backgroundImage: [
            'linear-gradient(45deg,var(--mf-viewer-check-b) 25%,transparent 25%)',
            'linear-gradient(-45deg,var(--mf-viewer-check-b) 25%,transparent 25%)',
            'linear-gradient(45deg,transparent 75%,var(--mf-viewer-check-b) 75%)',
            'linear-gradient(-45deg,transparent 75%,var(--mf-viewer-check-b) 75%)',
          ].join(','),
          backgroundSize: '18px 18px',
          backgroundPosition: '0 0,0 9px,9px -9px,-9px 0',
        }}
      >
        {src === null ? (
          <span className="text-body text-muted-foreground">Loading image…</span>
        ) : (
          <div
            className="bg-white shadow-[var(--mf-shadow-pop)] relative overflow-hidden"
            style={isFit ? { maxWidth: '86%', flexShrink: 0 } : { width: meta ? meta.w * zoom : 'auto', flexShrink: 0 }}
          >
            <ZoomableImage src={src} alt={alt} className="block w-full h-auto object-contain" onLoad={handleLoad} />
          </div>
        )}
      </div>
    </ViewerShell>
  );
}
