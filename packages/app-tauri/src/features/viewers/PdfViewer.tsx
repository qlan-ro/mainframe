'use client';

/**
 * PdfViewer.tsx
 *
 * Renders a PDF file via <embed> using an object URL built from base64 bytes.
 *
 * The <embed> element uses a blob: URL (createObjectURL) built from base64
 * bytes returned by the daemon. The Tauri CSP must allow blob: in object-src;
 * this is set in src-tauri/tauri.conf.json (object-src blob:).
 *
 * Props:
 *   base64   — base64-encoded PDF bytes; null while loading.
 *   mimeType — MIME type string, typically "application/pdf".
 *   path     — original file path, used for breadcrumb + "open externally" label.
 *
 * data-testid="viewer-pdf" on the root.
 * data-testid="viewer-pdf-fallback" on the open-externally button.
 */
import { useEffect, useState } from 'react';
import { openExternal } from '@/lib/tauri/bridge';
import { ViewerShell } from './ViewerShell';
import { formatBytes } from './viewer-status';

interface PdfViewerProps {
  base64: string | null;
  mimeType: string;
  path: string;
}

function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buf;
}

export function PdfViewer({ base64, mimeType, path }: PdfViewerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (base64 === null) {
      setObjectUrl(null);
      return;
    }

    const buf = base64ToArrayBuffer(base64);
    const blob = new Blob([buf], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [base64, mimeType]);

  async function handleOpenExternal() {
    if (!path) return;
    try {
      await openExternal(`file://${path}`);
    } catch (err) {
      console.warn('[PdfViewer] openExternal failed', err);
    }
  }

  const bytes = base64 ? base64ByteLength(base64) : 0;
  const status = base64 ? `PDF · ${formatBytes(bytes)}` : 'PDF · Loading…';

  return (
    <ViewerShell path={path} status={status}>
      <div data-testid="viewer-pdf" className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-2 [border-bottom:0.5px_solid_var(--border)] px-3 py-1.5">
          <span className="flex-1 truncate text-label text-muted-foreground">{path.split('/').pop()}</span>
          <button
            type="button"
            data-testid="viewer-pdf-fallback"
            onClick={() => void handleOpenExternal()}
            className="rounded px-2 py-0.5 text-label font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Open externally
          </button>
        </div>

        {/* Body */}
        {base64 === null ? (
          <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">Loading…</div>
        ) : objectUrl ? (
          <embed src={objectUrl} type={mimeType} className="w-full flex-1" title="PDF viewer" />
        ) : (
          <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">Loading…</div>
        )}
      </div>
    </ViewerShell>
  );
}
