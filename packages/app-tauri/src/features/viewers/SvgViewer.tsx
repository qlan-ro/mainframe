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
import { useEffect, useState } from 'react';

interface SvgViewerProps {
  content: string | null;
}

type SvgMode = 'preview' | 'source';

export function SvgViewer({ content }: SvgViewerProps) {
  const [mode, setMode] = useState<SvgMode>('preview');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Create an object URL whenever the SVG content changes.
  // Revoke the previous one via effect cleanup to avoid memory leaks.
  useEffect(() => {
    if (content === null) {
      setObjectUrl(null);
      return;
    }
    const blob = new Blob([content], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [content]);

  return (
    <div data-testid="viewer-svg" className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex shrink-0 items-center gap-1 [border-bottom:0.5px_solid_var(--border)] px-3 py-1.5">
        <button
          type="button"
          data-testid="viewer-svg-preview-toggle"
          aria-pressed={mode === 'preview'}
          onClick={() => setMode('preview')}
          className={[
            'rounded px-2 py-0.5 text-label font-medium transition-colors',
            mode === 'preview' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
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
            'rounded px-2 py-0.5 text-label font-medium transition-colors',
            mode === 'source' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          Source
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-auto">
        {content === null ? (
          <span className="m-auto text-body text-muted-foreground">Loading…</span>
        ) : mode === 'preview' ? (
          <div
            className="flex flex-1 items-center justify-center p-4"
            style={{
              background:
                'repeating-conic-gradient(var(--mf-checker-dark) 0% 25%, var(--mf-checker-light) 0% 50%) 0 0 / 16px 16px',
            }}
          >
            {objectUrl && <img src={objectUrl} alt="SVG preview" className="max-h-full max-w-full object-contain" />}
          </div>
        ) : (
          <pre
            data-testid="viewer-svg-source"
            className="mf-editor-selectable flex-1 overflow-auto p-4 text-label font-mono text-foreground"
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
