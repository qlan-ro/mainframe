/**
 * ReferencesPanel — shadcn-styled list of LSP `getReferences` results.
 *
 * Each row shows `<filename>:<line>` and the relevant code snippet.
 * Clicking a row emits `open-file` surface intent and (optionally)
 * calls `onSelectRange` to highlight the reference in the already-open editor.
 *
 * Rows are keyed by `<path>:<line>:<character>` — stable across re-renders.
 * `data-testid="editor-references-panel"` on the root.
 * `data-testid="editor-references-row-<path>:<line>"` on each row.
 */
import { useCallback } from 'react';
import type { LspLocation } from '@/lib/lsp';
import { emitSurfaceIntent } from '@/store/surface-intents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferencesPanelProps {
  /** Results from providers.getReferences. */
  locations: LspLocation[];
  /** Symbol name shown in the header (e.g. "validate"). */
  symbolName?: string;
  /** Called when a row is clicked — lets the parent highlight the range. */
  onSelectRange?: (location: LspLocation) => void;
  /** Called to close/dismiss the panel. */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uriToPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/** Stable row key: path:line:character. */
function rowKey(loc: LspLocation): string {
  return `${uriToPath(loc.uri)}:${loc.range.start.line}:${loc.range.start.character}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReferencesPanel({ locations, symbolName, onSelectRange, onClose }: ReferencesPanelProps) {
  const handleRowClick = useCallback(
    (loc: LspLocation) => {
      const path = uriToPath(loc.uri);
      emitSurfaceIntent({ type: 'open-file', path });
      onSelectRange?.(loc);
    },
    [onSelectRange],
  );

  const count = locations.length;
  const title = symbolName ? `References: ${symbolName}` : 'References';

  return (
    <div
      data-testid="editor-references-panel"
      className="flex flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-label font-medium">
          {title}
          <span className="ml-1.5 text-caption text-muted-foreground">({count})</span>
        </span>
        {onClose && (
          <button
            type="button"
            data-testid="editor-references-panel-close"
            onClick={onClose}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close references panel"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Location list */}
      {count === 0 ? (
        <div className="px-3 py-4 text-center text-caption text-muted-foreground">No references found.</div>
      ) : (
        <ul className="max-h-64 overflow-y-auto" role="list">
          {locations.map((loc) => {
            const path = uriToPath(loc.uri);
            const line = loc.range.start.line + 1; // 1-based display
            const key = rowKey(loc);
            const testId = `editor-references-row-${path}:${loc.range.start.line}`;

            return (
              <li key={key}>
                <button
                  type="button"
                  data-testid={testId}
                  onClick={() => handleRowClick(loc)}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">{basename(path)}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">:{line}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
