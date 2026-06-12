/**
 * ViewerShell.tsx
 *
 * Shared chrome frame for all file viewers. Mirrors the prototype
 * ViewerShell in docs/design-reference/prototype/15-viewers.jsx.
 *
 * Layout:
 *   Header (24px, bg-mf-tab-bar) — folder icon, breadcrumb dir segments with
 *     chevron separators, bold basename; optional actions slot; separator;
 *     Reveal in file tree button.
 *   Body (flex-1 overflow-hidden) — viewer content via `children`.
 *   Footer (20px, bg-mf-tab-bar) — mono 10px status string; optional
 *     right-aligned statusRight slot.
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
      <div className="flex h-6 shrink-0 items-center gap-1 border-b border-border bg-mf-tab-bar px-3 text-caption">
        <Folder size={10} className="shrink-0 text-mf-text-3" aria-hidden />

        {dirParts.map((segment, i) => (
          <React.Fragment key={i}>
            <span className="text-mf-text-3">{segment}</span>
            <ChevronRight size={8} className="shrink-0 text-mf-text-4" aria-hidden />
          </React.Fragment>
        ))}

        <span className="font-semibold text-foreground">{basename}</span>

        <div className="flex-1" />

        {actions}

        <div className="mx-0.5 h-[13px] w-px bg-border" />

        <button
          data-testid="viewer-shell-reveal"
          title="Reveal in file tree"
          className="inline-flex h-5 w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-muted-foreground transition-colors hover:bg-accent"
          onClick={handleReveal}
          type="button"
        >
          <Crosshair size={12} aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>

      {/* Footer / status */}
      <div className="flex h-5 shrink-0 items-center border-t border-border bg-mf-tab-bar px-2.5">
        <span data-testid="viewer-shell-status" className="text-micro font-mono text-mf-text-4">
          {status}
        </span>
        {statusRight && (
          <>
            <div className="flex-1" />
            <span className="text-micro font-mono text-mf-text-4">{statusRight}</span>
          </>
        )}
      </div>
    </div>
  );
}
