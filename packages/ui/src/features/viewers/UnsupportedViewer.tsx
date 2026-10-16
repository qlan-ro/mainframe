'use client';

/**
 * UnsupportedViewer.tsx
 *
 * Empty-state card rendered by the viewer router when no dedicated viewer
 * exists for the file type. Replaces the raw <pre> fallback.
 *
 * Layout:
 *   Wrapped in ViewerShell for the standard breadcrumb + status footer.
 *   Body: centered v2 Card with:
 *     - 44×44 bg-muted icon chip containing a File icon.
 *     - "No preview available" heading.
 *     - Subtext with the filename.
 *     - Two action buttons:
 *         "Open externally" — opens the file with its default app.
 *         "Reveal in tree"  — outline secondary.
 *
 * data-testids:
 *   viewer-unsupported         — root wrapper element
 *   viewer-unsupported-card    — centered card element
 *   viewer-unsupported-icon-chip — 44×44 icon chip container
 *   viewer-unsupported-open    — "Open externally" button
 *   viewer-unsupported-reveal  — "Reveal in tree" button
 */
import { File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { ViewerShell } from './ViewerShell';
import { useNativeFileAction } from './viewer-file-path';

interface UnsupportedViewerProps {
  path: string;
}

export function UnsupportedViewer({ path }: UnsupportedViewerProps) {
  const basename = path.split('/').pop() ?? path;
  const ext = basename.includes('.') ? (basename.split('.').pop() ?? '') : '';
  const status = ext ? `${ext.toUpperCase()} · No preview` : 'No preview';

  const openFile = useNativeFileAction(path, 'open');

  function handleReveal() {
    emitSurfaceIntent({ type: 'reveal-file', path });
  }

  return (
    <ViewerShell path={path} status={status}>
      <div
        data-testid="viewer-unsupported"
        className="flex h-full flex-col items-center justify-center gap-4 bg-muted/40"
      >
        <Card data-testid="viewer-unsupported-card" className="items-center gap-3 px-6 py-6 text-center">
          <div
            data-testid="viewer-unsupported-icon-chip"
            className="mx-auto mb-0.5 grid size-11 place-items-center rounded-lg bg-muted"
          >
            <File className="size-5.5 text-muted-foreground" aria-hidden />
          </div>

          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground">No preview available</h2>
            <p className="text-xs text-muted-foreground">
              Mainframe can&apos;t render <code className="font-mono text-xs text-foreground">{basename}</code> inline.
            </p>
          </div>

          <div className="flex gap-2">
            <Hint label={openFile.disabledReason ?? undefined}>
              <Button
                data-testid="viewer-unsupported-open"
                size="sm"
                onClick={() => void openFile.run()}
                disabled={openFile.disabledReason !== null}
                aria-disabled={openFile.disabledReason !== null}
              >
                Open externally
              </Button>
            </Hint>
            <Button data-testid="viewer-unsupported-reveal" variant="outline" size="sm" onClick={handleReveal}>
              Reveal in tree
            </Button>
          </div>
        </Card>
      </div>
    </ViewerShell>
  );
}
