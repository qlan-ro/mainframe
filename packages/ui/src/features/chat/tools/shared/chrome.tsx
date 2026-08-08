/**
 * Shared chrome for tool cards — status dots, card frame, file-path pill.
 *
 * Note: StatusDot here accepts raw `result`/`isError` booleans.
 * The assistant-ui status-dot lives in tool-status.ts and uses
 * ToolCallMessagePartStatus.type — different concern.
 */
import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOpenFile } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

/**
 * Three-state dot: pending (pulsing muted), error (destructive), success.
 * `result === undefined` = the tool call is still in flight. **Dot only** — the
 * coloured dot alone conveys running/failed/done (decided 2026-06-21; the
 * "Running"/"Failed"/"Done" word was redundant).
 */
export function StatusDot({ result, isError }: { result: unknown; isError: boolean | undefined }) {
  const status = result === undefined ? 'pending' : isError ? 'error' : 'success';
  const dotClass =
    status === 'pending'
      ? 'bg-muted-foreground/40 animate-pulse'
      : status === 'error'
        ? 'bg-destructive'
        : 'bg-success';
  return (
    <span className="inline-flex shrink-0 items-center">
      <span data-testid="tool-card-status-dot" data-status={status} className={cn('size-2 rounded-full', dotClass)} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// ErrorDot
// ---------------------------------------------------------------------------

/** Renders a destructive dot only when `isError` is true. */
export function ErrorDot({ isError }: { isError: boolean | undefined }) {
  if (!isError) return null;
  return <span className="size-2 shrink-0 rounded-full bg-destructive" />;
}

// ---------------------------------------------------------------------------
// cardStyle — Tailwind class helper for card framing
// ---------------------------------------------------------------------------

/** The full card-frame class string for a tool card shell. */
export function cardStyle(result: unknown, isError: boolean | undefined): string {
  const base = 'overflow-hidden rounded-lg border bg-card';
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
 * Uses `useOpenFile()` from chat-tool-context for the surface-intent bus.
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
          data-file-path={filePath}
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className="cursor-pointer truncate font-mono text-sm text-primary underline-offset-4 hover:underline"
        >
          {shortFilename(filePath)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{filePath}</TooltipContent>
    </Tooltip>
  );
}
