'use client';

/**
 * UnsupportedViewer.tsx
 *
 * Empty-state card rendered by the viewer router when no dedicated viewer
 * exists for the file type. Replaces the raw <pre> fallback.
 *
 * Layout:
 *   Wrapped in ViewerShell for the standard breadcrumb + status footer.
 *   Body: centered card with a file icon, "No preview available" heading,
 *   subtext, and two action buttons:
 *     - "Open externally" — opens the file in the OS default app.
 *     - "Reveal in tree"  — emits the reveal-file surface intent.
 *
 * data-testids:
 *   viewer-unsupported       — root card element
 *   viewer-unsupported-open  — "Open externally" button
 *   viewer-unsupported-reveal — "Reveal in tree" button
 */
import { FileX } from 'lucide-react';
import { openExternal } from '@/lib/tauri/bridge';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { ViewerShell } from './ViewerShell';
import { toFileUrl } from './viewer-file-url';

interface UnsupportedViewerProps {
  path: string;
}

export function UnsupportedViewer({ path }: UnsupportedViewerProps) {
  const basename = path.split('/').pop() ?? path;
  const ext = basename.includes('.') ? (basename.split('.').pop() ?? '') : '';
  const status = ext ? `${ext.toUpperCase()} · No preview` : 'No preview';

  const { projectPath } = useActiveIdentity();
  const fileUrl = toFileUrl(path, projectPath);

  async function handleOpenExternal() {
    if (!fileUrl) return;
    try {
      await openExternal(fileUrl);
    } catch (err) {
      console.warn('[UnsupportedViewer] openExternal failed', err);
    }
  }

  function handleReveal() {
    emitSurfaceIntent({ type: 'reveal-file', path });
  }

  return (
    <ViewerShell path={path} status={status}>
      <div data-testid="viewer-unsupported" className="flex h-full flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-mf-tab-bar px-10 py-8 text-center shadow-sm">
          <FileX size={32} className="text-mf-text-3" aria-hidden />

          <div className="flex flex-col gap-1">
            <h2 className="text-body font-semibold text-foreground">No preview available</h2>
            <p className="text-label text-mf-text-3">{"Mainframe can't render this file type inline"}</p>
          </div>

          <div className="flex gap-2">
            <button
              data-testid="viewer-unsupported-open"
              type="button"
              onClick={() => void handleOpenExternal()}
              disabled={fileUrl === null}
              title={fileUrl === null ? 'Cannot open: project root is unknown for this relative path' : undefined}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 text-label font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open externally
            </button>
            <button
              data-testid="viewer-unsupported-reveal"
              type="button"
              onClick={handleReveal}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 text-label font-medium text-foreground transition-colors hover:bg-accent"
            >
              Reveal in tree
            </button>
          </div>
        </div>
      </div>
    </ViewerShell>
  );
}
