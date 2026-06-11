'use client';

/**
 * viewer-router.tsx
 *
 * Given a file path, picks the correct viewer component:
 *   image  → ImageViewer   (.png / .jpg / .jpeg / .gif / .webp)
 *   svg    → SvgViewer     (.svg)
 *   csv    → CsvViewer     (.csv)
 *   pdf    → PdfViewer     (.pdf)
 *   code   → CmEditor      (everything else; caller must wire Phase 7)
 *
 * File loading is daemon-first (worktree-aware): project files are fetched via
 * the daemon REST API. The Tauri bridge is the fallback only when there is no
 * active project context (absolute path, no worktree).
 */
import { type ReactNode, useEffect, useState } from 'react';
import { readFile, readFileBase64 } from '@/lib/tauri/bridge';
import { getProjectFile, getProjectFileBase64 } from '@/lib/api/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { ImageViewer } from './ImageViewer';
import { SvgViewer } from './SvgViewer';
import { CsvViewer } from './CsvViewer';
import { PdfViewer } from './PdfViewer';

// ── Viewer kind discriminant ─────────────────────────────────────────────────

export type ViewerKind = 'image' | 'svg' | 'csv' | 'pdf' | 'code';

/** Extensions that map to a binary image viewer. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** Extensions that map to a dedicated text/binary viewer. */
const VIEWER_EXT_MAP: Record<string, ViewerKind> = {
  svg: 'svg',
  csv: 'csv',
  pdf: 'pdf',
};

/**
 * Pick the viewer kind for a given file path.
 * Extension matching is case-insensitive.
 * Everything that does not match a viewer falls through to `"code"`.
 *
 * @pure — no side-effects, safe to call in tests and render functions.
 */
export function pickViewerKind(filePath: string): ViewerKind {
  const basename = filePath.split('/').pop() ?? filePath;
  const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : undefined;
  if (!ext) return 'code';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return VIEWER_EXT_MAP[ext] ?? 'code';
}

// ── Mime type helper ─────────────────────────────────────────────────────────

function imageDataUrl(ext: string, base64: string): string {
  const mime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return `data:${mime[ext] ?? 'application/octet-stream'};base64,${base64}`;
}

// ── ViewerRouter component ───────────────────────────────────────────────────

interface ViewerRouterProps {
  /** Absolute or repo-relative file path to display. */
  path: string;
  /**
   * Render prop called when the path resolves to a `"code"` kind.
   * Phase 7 wires this to `<CmEditor>` via the Files surface.
   * If omitted, a plain pre-formatted fallback is rendered.
   */
  renderCode?: (path: string) => ReactNode;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; kind: ViewerKind; content: string | null }
  | { status: 'error'; message: string };

export function ViewerRouter({ path, renderCode }: ViewerRouterProps) {
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();

  useEffect(() => {
    if (!path) return;

    let cancelled = false;
    setState({ status: 'loading' });

    const kind = pickViewerKind(path);

    async function load() {
      try {
        if (kind === 'code') {
          // Code files are handled by the renderCode prop; no file read needed.
          if (!cancelled) setState({ status: 'ready', kind, content: null });
          return;
        }

        // Binary kinds (image, pdf) need base64; text kinds need UTF-8.
        const isBinary = kind === 'image' || kind === 'pdf';

        let raw: string | null;
        if (isBinary) {
          raw = projectId ? await getProjectFileBase64(port, projectId, path, chatId) : await readFileBase64(path);
        } else {
          raw = projectId ? await getProjectFile(port, projectId, path, chatId) : await readFile(path);
        }

        if (cancelled) return;

        if (raw == null) {
          setState({ status: 'error', message: 'File not found or unreadable' });
          return;
        }

        const content = raw;

        if (kind === 'image') {
          const ext = (path.split('.').pop() ?? '').toLowerCase();
          setState({ status: 'ready', kind, content: imageDataUrl(ext, content) });
        } else {
          setState({ status: 'ready', kind, content });
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[ViewerRouter] failed to load file', path, message);
          setState({ status: 'error', message });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [path, port, projectId, chatId]);

  if (state.status === 'idle' || state.status === 'loading') {
    return <div className="flex h-full items-center justify-center text-body text-muted-foreground">Loading…</div>;
  }

  if (state.status === 'error') {
    return <div className="flex h-full items-center justify-center text-body text-destructive">{state.message}</div>;
  }

  const { kind, content } = state;

  if (kind === 'code') {
    return renderCode ? (
      <>{renderCode(path)}</>
    ) : (
      <pre className="h-full overflow-auto p-4 text-label font-mono text-foreground">{path}</pre>
    );
  }

  if (kind === 'image') {
    return <ImageViewer src={content} />;
  }

  if (kind === 'svg') {
    return <SvgViewer content={content} />;
  }

  if (kind === 'csv') {
    return <CsvViewer content={content} />;
  }

  // kind === 'pdf'
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const mime = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';
  return <PdfViewer base64={content} mimeType={mime} path={path} />;
}
