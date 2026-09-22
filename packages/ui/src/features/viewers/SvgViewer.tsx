'use client';

/**
 * SvgViewer.tsx
 *
 * Renders SVG files safely in two modes:
 *   Preview — renders via <img src={objectURL}> (avoids dangerouslySetInnerHTML
 *              on untrusted SVG; object URLs sandbox script execution). No
 *              annotation affordance — an image is not line-addressable.
 *   Source  — the read-only comment-gutter editor over the raw SVG markup, so
 *              the file can be annotated line by line like a code file.
 *
 * A Preview ⇄ Source toggle appears in the viewer header. The file tab owns
 * one agent-notes set (survives the toggle) with one NotesSubmitBar shown in
 * both modes.
 *
 * Props:
 *   content — raw SVG text string; null while loading.
 *   path    — file path used by ViewerShell for breadcrumb + reveal, and as
 *             the review-send target.
 *
 * data-testid="viewer-svg" on the root; toggle buttons carry their own testids;
 * Source mode's editor host carries data-testid="viewer-svg-source".
 */
import { useEffect, useState } from 'react';
import { ViewerShell } from './ViewerShell';
import { Segmented } from './Segmented';
import { checkerStyle } from './viewer-checker';
import { splitSvgStatus } from './viewer-status';
import { CmEditorWithComments } from '@/features/editor/inline-comments/CmEditorWithComments';
import { useFileTabNotes } from '@/features/editor/inline-comments/use-file-notes';
import { inferLanguage } from '@/lib/editor/file-types';

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

export function SvgViewer({ content, path }: SvgViewerProps) {
  const [mode, setMode] = useState<SvgMode>('preview');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const { model, submitBar } = useFileTabNotes({ filePath: path });

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
    <Segmented
      value={mode}
      onChange={(id) => setMode(id as SvgMode)}
      options={[
        { id: 'preview', label: 'Preview', testId: 'viewer-svg-preview-toggle' },
        { id: 'source', label: 'Source', testId: 'viewer-svg-source-toggle' },
      ]}
    />
  );

  return (
    <ViewerShell path={path} status={statusLeft} statusRight={statusRight || undefined} actions={seg}>
      <div data-testid="viewer-svg" className="flex h-full flex-col">
        {submitBar}
        {content === null ? (
          <div className="flex flex-1 items-center justify-center overflow-auto">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : mode === 'preview' ? (
          <div className="flex flex-1 items-center justify-center overflow-auto p-8" style={checkerStyle}>
            <div className="rounded-lg bg-background p-9 shadow-md">
              {objectUrl && <img src={objectUrl} alt="SVG preview" className="max-h-full max-w-full object-contain" />}
            </div>
          </div>
        ) : (
          <div data-testid="viewer-svg-source" className="mf-editor-selectable flex min-h-0 flex-1 flex-col">
            <CmEditorWithComments
              value={content}
              language={inferLanguage(path)}
              readOnly
              onChange={() => undefined}
              path={path}
              filePath={path}
              model={model}
            />
          </div>
        )}
      </div>
    </ViewerShell>
  );
}
