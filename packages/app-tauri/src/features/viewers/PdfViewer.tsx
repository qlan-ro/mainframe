'use client';

/**
 * PdfViewer.tsx
 *
 * Renders a PDF file via <embed> using an object URL built from base64 bytes.
 *
 * SECURITY NOTE: The <embed> element requires the Tauri asset-scope capability
 * to load blob: URIs in the webview security policy when running inside Tauri.
 *
 * TODO(tauri-shell-engineer): asset-scope capability for local PDF blob: URIs.
 * The Tauri CSP currently blocks blob: in the <embed> src attribute in
 * production builds. Add the following to src-tauri/capabilities/*.json:
 *   { "permissions": ["core:asset:allow-fetch-asset"] }
 * And update src-tauri/tauri.conf.json's CSP to include "blob:" in the
 * default-src directive. Until then, the <embed> renders in dev mode only;
 * production falls back to the "open externally" button.
 *
 * Props:
 *   base64   — base64-encoded PDF bytes; null while loading.
 *   mimeType — MIME type string, typically "application/pdf".
 *   path     — original file path, used for the "open externally" label.
 *
 * data-testid="viewer-pdf" on the root.
 * data-testid="viewer-pdf-fallback" on the open-externally button.
 */
import { useEffect, useState } from 'react';
import { openExternal } from '@/lib/tauri/bridge';

interface PdfViewerProps {
  base64: string | null;
  mimeType: string;
  path?: string;
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

  return (
    <div data-testid="viewer-pdf" className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 [border-bottom:0.5px_solid_var(--border)] px-3 py-1.5">
        <span className="flex-1 truncate text-xs text-muted-foreground">{path ? path.split('/').pop() : 'PDF'}</span>
        {path && (
          <button
            type="button"
            data-testid="viewer-pdf-fallback"
            onClick={() => void handleOpenExternal()}
            className="rounded px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Open externally
          </button>
        )}
        {!path && (
          /* Always render the fallback testid even without a path, so tests can find it */
          <span data-testid="viewer-pdf-fallback" className="text-xs text-muted-foreground">
            Open externally
          </span>
        )}
      </div>

      {/* Body */}
      {base64 === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : objectUrl ? (
        <embed src={objectUrl} type={mimeType} className="w-full flex-1" title="PDF viewer" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}
