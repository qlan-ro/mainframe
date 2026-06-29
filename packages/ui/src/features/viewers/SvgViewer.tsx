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
 *   path    — file path used by ViewerShell for breadcrumb + reveal.
 *
 * data-testid="viewer-svg" on the root; toggle buttons carry their own testids.
 */
import { useEffect, useState } from 'react';
import { ViewerShell } from './ViewerShell';
import { splitSvgStatus } from './viewer-status';

interface SvgViewerProps {
  content: string | null;
  path: string;
}

type SvgMode = 'preview' | 'source';

/** Parse viewBox, width, height from SVG text. Returns null when absent. */
function parseSvgMeta(svg: string): { viewBox: string; w: number; h: number } | null {
  const viewBoxMatch = /viewBox="([^"]+)"/.exec(svg);
  const widthMatch = /\bwidth="([^"]+)"/.exec(svg);
  const heightMatch = /\bheight="([^"]+)"/.exec(svg);
  if (!viewBoxMatch) return null;
  const viewBox = viewBoxMatch[1] ?? '';
  const parts = viewBox.split(/\s+/);
  const vbW = parts[2] != null ? parseInt(parts[2], 10) : NaN;
  const vbH = parts[3] != null ? parseInt(parts[3], 10) : NaN;
  const w = widthMatch ? parseInt(widthMatch[1] ?? '0', 10) : vbW;
  const h = heightMatch ? parseInt(heightMatch[1] ?? '0', 10) : vbH;
  if (!viewBox || isNaN(w) || isNaN(h)) return null;
  return { viewBox, w, h };
}

const SEG_BTN = 'rounded-sm px-1.5 py-0.5 text-caption font-medium transition-colors';
const SEG_ACTIVE = 'bg-background text-foreground shadow-[var(--mf-shadow-segment)]';
const SEG_IDLE = 'text-mf-text-3 hover:text-foreground';

export function SvgViewer({ content, path }: SvgViewerProps) {
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

  const svgMeta = content ? parseSvgMeta(content) : null;
  const bytes = content ? new TextEncoder().encode(content).length : 0;
  const { left: statusLeft, right: statusRight } = svgMeta
    ? splitSvgStatus({ viewBox: svgMeta.viewBox, w: svgMeta.w, h: svgMeta.h, bytes })
    : { left: 'SVG · Loading…', right: '' };

  // Preview/Source segmented toggle — lives in the ViewerShell breadcrumb header.
  const seg = (
    <div className="inline-flex items-center gap-px rounded-md bg-mf-chip p-0.5">
      <button
        type="button"
        data-testid="viewer-svg-preview-toggle"
        aria-pressed={mode === 'preview'}
        onClick={() => setMode('preview')}
        className={`${SEG_BTN} ${mode === 'preview' ? SEG_ACTIVE : SEG_IDLE}`}
      >
        Preview
      </button>
      <button
        type="button"
        data-testid="viewer-svg-source-toggle"
        aria-pressed={mode === 'source'}
        onClick={() => setMode('source')}
        className={`${SEG_BTN} ${mode === 'source' ? SEG_ACTIVE : SEG_IDLE}`}
      >
        Code
      </button>
    </div>
  );

  return (
    <ViewerShell path={path} status={statusLeft} statusRight={statusRight || undefined} actions={seg}>
      <div data-testid="viewer-svg" className="flex h-full flex-col">
        <div className="flex flex-1 overflow-auto">
          {content === null ? (
            <span className="m-auto text-body text-muted-foreground">Loading…</span>
          ) : mode === 'preview' ? (
            <div
              className="flex flex-1 items-center justify-center p-[32px]"
              style={{
                background:
                  'repeating-conic-gradient(var(--mf-viewer-check-b) 0% 25%, var(--mf-viewer-check-a) 0% 50%) 0 0 / 18px 18px',
              }}
            >
              <div className="rounded-[11px] bg-background p-[36px] shadow-[var(--mf-shadow-pop)]">
                {objectUrl && (
                  <img src={objectUrl} alt="SVG preview" className="max-h-full max-w-full object-contain" />
                )}
              </div>
            </div>
          ) : (
            <pre
              data-testid="viewer-svg-source"
              className="mf-editor-selectable flex-1 overflow-auto bg-mf-code-bg px-[18px] py-[16px] leading-relaxed text-label font-mono text-mf-code-fg"
            >
              {content}
            </pre>
          )}
        </div>
      </div>
    </ViewerShell>
  );
}
