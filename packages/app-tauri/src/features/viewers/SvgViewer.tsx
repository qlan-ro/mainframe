'use client';

/**
 * SvgViewer.tsx
 *
 * Renders SVG files safely in two modes:
 *   Preview — renders via <img src={objectURL}> (avoids dangerouslySetInnerHTML
 *              on untrusted SVG; object URLs sandbox script execution).
 *   Source  — shows the raw SVG text in a styled <pre>.
 *
 * A Preview ⇄ Source toggle button pair appears in the viewer header.
 *
 * Props:
 *   content — raw SVG text string; null while loading.
 *
 * data-testid="viewer-svg" on the root; toggle buttons carry their own testids.
 */
import { useEffect, useRef, useState } from 'react';

interface SvgViewerProps {
  content: string | null;
}

type SvgMode = 'preview' | 'source';

export function SvgViewer({ content }: SvgViewerProps) {
  const [mode, setMode] = useState<SvgMode>('preview');
  const objectUrlRef = useRef<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Create an object URL whenever the SVG content changes.
  // Revoke the previous one to avoid memory leaks.
  useEffect(() => {
    if (content === null) {
      setObjectUrl(null);
      return;
    }
    const blob = new Blob([content], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    setObjectUrl(url);

    return () => {
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
    };
  }, [content]);

  return (
    <div data-testid="viewer-svg" className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-mf-border px-3 py-1.5">
        <button
          type="button"
          data-testid="viewer-svg-preview-toggle"
          aria-pressed={mode === 'preview'}
          onClick={() => setMode('preview')}
          className={[
            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
            mode === 'preview'
              ? 'bg-mf-hover text-mf-text-primary'
              : 'text-mf-text-secondary hover:text-mf-text-primary',
          ].join(' ')}
        >
          Preview
        </button>
        <button
          type="button"
          data-testid="viewer-svg-source-toggle"
          aria-pressed={mode === 'source'}
          onClick={() => setMode('source')}
          className={[
            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
            mode === 'source'
              ? 'bg-mf-hover text-mf-text-primary'
              : 'text-mf-text-secondary hover:text-mf-text-primary',
          ].join(' ')}
        >
          Source
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-auto">
        {content === null ? (
          <span className="m-auto text-sm text-mf-text-secondary">Loading…</span>
        ) : mode === 'preview' ? (
          <div
            className="flex flex-1 items-center justify-center p-4"
            style={{
              background:
                'var(--mf-checkerboard, repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 0 0 / 16px 16px)',
            }}
          >
            {objectUrl && <img src={objectUrl} alt="SVG preview" className="max-h-full max-w-full object-contain" />}
          </div>
        ) : (
          <pre
            data-testid="viewer-svg-source"
            className="mf-editor-selectable flex-1 overflow-auto p-4 text-xs font-mono text-mf-text-primary"
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
