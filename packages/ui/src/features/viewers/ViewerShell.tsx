/**
 * ViewerShell.tsx
 *
 * Shared chrome frame for all file viewers.
 *
 * Layout:
 *   Header (28px, bg-muted) — folder icon, breadcrumb dir segments with
 *     chevron separators, basename; optional actions slot; separator;
 *     Reveal in file tree button.
 *   Body (flex-1 overflow-hidden) — viewer content via `children`.
 *   Footer (20px, bg-muted) — mono status string; optional right-aligned
 *     statusRight slot.
 *
 * Props:
 *   path         — absolute or relative file path used to build the breadcrumb.
 *   status       — mono status string rendered left-aligned in the footer.
 *   statusRight  — optional right-aligned footer content (word count, etc.).
 *   actions      — optional React node inserted before the separator + Reveal
 *                  button in the header.
 *   children     — viewer body content.
 */
import React from 'react';
import { ChevronRight, Crosshair, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Separator } from '@/components/ui/separator';
import { emitSurfaceIntent } from '@/store/surface-intents';

interface ViewerShellProps {
  path: string;
  status: string;
  statusRight?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function ViewerShell({ path, status, statusRight, actions, children }: ViewerShellProps) {
  const parts = path.split('/').filter(Boolean);
  const basename = parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
  const dirParts = parts.slice(0, -1);

  function handleReveal() {
    emitSurfaceIntent({ type: 'reveal-file', path });
  }

  return (
    <div data-testid="viewer-shell" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header / breadcrumb */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-muted pr-1.5 pl-5 text-xs">
        <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />

        {dirParts.map((segment, i) => (
          <React.Fragment key={i}>
            <span className="text-muted-foreground">{segment}</span>
            <ChevronRight className="size-2.5 shrink-0 text-muted-foreground/50" aria-hidden />
          </React.Fragment>
        ))}

        <span className="font-semibold text-foreground">{basename}</span>

        <div className="flex-1" />

        {actions}

        <Separator orientation="vertical" className="mx-0.5 h-3 data-vertical:self-center" />

        <Hint label="Reveal in file tree">
          <Button data-testid="viewer-shell-reveal" variant="ghost" size="icon-xs" onClick={handleReveal}>
            <Crosshair />
          </Button>
        </Hint>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>

      {/* Footer / status */}
      <div className="flex h-5 shrink-0 items-center gap-2.5 border-t border-border bg-muted px-2.5">
        <span data-testid="viewer-shell-status" className="font-mono text-xs text-muted-foreground">
          {status}
        </span>
        {statusRight && (
          <>
            <div className="flex-1" />
            <span className="font-mono text-xs text-muted-foreground">{statusRight}</span>
          </>
        )}
      </div>
    </div>
  );
}
