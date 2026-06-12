/**
 * ViewerShell.tsx
 *
 * Shared chrome frame for all file viewers. Mirrors the prototype
 * ViewerShell in docs/design-reference/prototype/15-viewers.jsx.
 *
 * Layout:
 *   Header (24px, bg-mf-tab-bar) — breadcrumb dir + basename, optional
 *     actions slot, Reveal in file tree button.
 *   Body (flex-1, overflow-auto) — viewer content via `children`.
 *   Footer (20px, bg-mf-tab-bar) — mono status string.
 *
 * Props:
 *   path     — absolute or relative file path used to build the breadcrumb.
 *   status   — mono status line rendered in the footer.
 *   actions  — optional React node inserted before the Reveal button.
 *   children — viewer body content.
 */
import React from 'react';
import { emitSurfaceIntent } from '@/store/surface-intents';

interface ViewerShellProps {
  path: string;
  status: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function ViewerShell({ path, status, actions, children }: ViewerShellProps) {
  const parts = path.split('/').filter(Boolean);
  const basename = parts[parts.length - 1] ?? path;
  const dirParts = parts.slice(0, -1);
  const dir = dirParts.join('/');

  function handleReveal() {
    emitSurfaceIntent({ type: 'reveal-file', path });
  }

  return (
    <div data-testid="viewer-shell" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header / breadcrumb */}
      <div className="flex h-6 shrink-0 items-center gap-1 border-b border-[color:var(--mf-hairline)] bg-mf-tab-bar px-3 text-[11px]">
        {dir && <span className="text-mf-text-4">{dir}/</span>}
        <span className="font-semibold text-foreground">{basename}</span>

        <div className="flex-1" />

        {actions}

        {actions && <div className="mx-0.5 h-[13px] w-px bg-border" />}

        <button
          data-testid="viewer-shell-reveal"
          title="Reveal in file tree"
          className="inline-flex h-5 w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-mf-hover"
          onClick={handleReveal}
          type="button"
        >
          {/* locate icon — simple target circle representation */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" className="text-mf-text-4" />
            <circle cx="6" cy="6" r="1.5" fill="currentColor" className="text-mf-text-4" />
            <line x1="6" y1="0" x2="6" y2="2" stroke="currentColor" strokeWidth="1" className="text-mf-text-4" />
            <line x1="6" y1="10" x2="6" y2="12" stroke="currentColor" strokeWidth="1" className="text-mf-text-4" />
            <line x1="0" y1="6" x2="2" y2="6" stroke="currentColor" strokeWidth="1" className="text-mf-text-4" />
            <line x1="10" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1" className="text-mf-text-4" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-auto">{children}</div>

      {/* Footer / status */}
      <div className="flex h-5 shrink-0 items-center border-t border-[color:var(--mf-hairline)] bg-mf-tab-bar px-2.5">
        <span data-testid="viewer-shell-status" className="text-caption font-mono text-mf-text-4">
          {status}
        </span>
      </div>
    </div>
  );
}
