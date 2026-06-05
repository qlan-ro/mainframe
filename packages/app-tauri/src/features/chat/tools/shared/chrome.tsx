/**
 * Shared chrome components for tool cards — status dots, file path pill.
 *
 * Token map (desktop → app-tauri warm-chrome):
 *   bg-mf-text-secondary/40 (animate-pulse) → bg-muted-foreground opacity-40 animate-pulse
 *   bg-mf-chat-error                         → bg-destructive
 *   bg-mf-success                            → bg-mf-success  (kept — exists in globals.css)
 *   text-mf-accent                           → text-primary
 *   text-mf-body                             → text-body
 *   border-l-mf-divider                      → border-l-border
 *   border-l-mf-chat-error                   → border-l-destructive
 *   border-l-mf-chat-diff-added (success accent) → border-l-mf-diff-add-border
 *   bg-mf-input-bg/40                        → bg-card  (card is the raised-input surface)
 *   border-mf-chat-error/30                  → border-destructive  (opacity not used; just the token)
 *   border-mf-divider                        → border-border
 *   rounded-mf-card                          → rounded-lg
 *
 * No /opacity modifier on any --mf-* var (CSS-var hex trap).
 * StatusDot's "pending" animation uses opacity-40 as a utility class,
 * not a color modifier — which is correct.
 *
 * Note: StatusDot here accepts raw `result`/`isError` booleans (legacy API
 * matching desktop's ToolCardProps). The assistant-ui status-dot lives in
 * tool-status.ts and uses ToolCallMessagePartStatus.type — different concern.
 */
import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useOpenFile } from '../chat-tool-context';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

/**
 * Three-state dot: pending (pulsing muted), error (destructive), success (mf-success).
 * `result === undefined` = the tool call is still in flight.
 *
 * When `label` is true, renders a short text label beside the dot:
 * "Running" / "Failed" / "Done".
 */
export function StatusDot({
  result,
  isError,
  label,
}: {
  result: unknown;
  isError: boolean | undefined;
  label?: boolean;
}) {
  if (result === undefined) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        <span className="w-2 h-2 rounded-full bg-muted-foreground opacity-40 animate-pulse" />
        {label && <span className="text-micro font-semibold text-muted-foreground">Running</span>}
      </span>
    );
  }
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        <span className="w-2 h-2 rounded-full bg-destructive" />
        {label && <span className="text-micro font-semibold text-destructive">Failed</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span className="w-2 h-2 rounded-full bg-mf-success" />
      {label && <span className="text-micro font-semibold text-mf-success">Done</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ErrorDot
// ---------------------------------------------------------------------------

/** Renders a destructive dot only when `isError` is true. */
export function ErrorDot({ isError }: { isError: boolean | undefined }) {
  if (!isError) return null;
  return <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />;
}

// ---------------------------------------------------------------------------
// borderColor / cardStyle — Tailwind class helpers for card framing
// ---------------------------------------------------------------------------

/**
 * Returns the left-border Tailwind class reflecting the tool result state.
 * Callers apply this as e.g. `border-l-2 ${borderColor(result, isError)}`.
 */
export function borderColor(result: unknown, isError: boolean | undefined): string {
  if (result === undefined) return 'border-l-border';
  if (isError) return 'border-l-destructive';
  return 'border-l-mf-diff-add-border';
}

/**
 * Returns the full card-frame Tailwind class string for a tool card shell.
 * Uses solid tokens only — no /opacity modifier on CSS-var colors.
 */
export function cardStyle(result: unknown, isError: boolean | undefined): string {
  const base = 'border rounded-lg bg-card overflow-hidden';
  if (isError && result !== undefined) {
    return cn(base, 'border-destructive');
  }
  return cn(base, 'border-border');
}

// ---------------------------------------------------------------------------
// shortFilename
// ---------------------------------------------------------------------------

/** Returns the last two path segments so long absolute paths fit in the header. */
export function shortFilename(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : filePath;
}

// ---------------------------------------------------------------------------
// ClickableFilePath
// ---------------------------------------------------------------------------

/**
 * A clickable file-path badge that opens the file in the editor surface.
 * Uses `useOpenFile()` from chat-tool-context for the surface-intent bus;
 * replaces desktop's `useTabsStore` reach-through.
 */
export function ClickableFilePath({ filePath }: { filePath: string }) {
  const { openFile, revealFile } = useOpenFile();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openFile(filePath);
    revealFile(filePath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openFile(filePath);
      revealFile(filePath);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="tool-card-file-path"
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className="font-mono text-primary text-body truncate hover:underline cursor-pointer"
        >
          {shortFilename(filePath)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{filePath}</TooltipContent>
    </Tooltip>
  );
}
