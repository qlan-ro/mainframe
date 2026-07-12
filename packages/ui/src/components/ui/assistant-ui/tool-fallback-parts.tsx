/**
 * Sub-content slots for ToolFallback — split to keep parent file < 300 lines.
 * Args, Result, and Error are purely presentational; they only receive props.
 */
import { cn } from '@/lib/utils';
import type { ToolCallMessagePartStatus } from '@assistant-ui/react';

// ── Args ──────────────────────────────────────────────────────────────────────

export function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<'div'> & { argsText?: string }) {
  if (!argsText) return null;

  return (
    <div
      data-slot="tool-fallback-args"
      data-testid="chat-tool-fallback-args"
      className={cn('aui-tool-fallback-args', className)}
      {...props}
    >
      <pre className="aui-tool-fallback-args-value text-label text-muted-foreground whitespace-pre-wrap font-mono break-all">
        {argsText}
      </pre>
    </div>
  );
}

// ── Result ────────────────────────────────────────────────────────────────────

export function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<'div'> & { result?: unknown }) {
  if (result === undefined) return null;

  return (
    <div
      data-slot="tool-fallback-result"
      data-testid="chat-tool-fallback-result"
      className={cn('aui-tool-fallback-result border-t border-dashed border-border pt-2', className)}
      {...props}
    >
      <p className="aui-tool-fallback-result-header text-label font-semibold text-muted-foreground mb-1">Result</p>
      <pre className="aui-tool-fallback-result-content text-label text-muted-foreground whitespace-pre-wrap font-mono break-all">
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────

export function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & { status?: ToolCallMessagePartStatus }) {
  if (status?.type !== 'incomplete') return null;

  const error = status.error;
  const errorText = error ? (typeof error === 'string' ? error : JSON.stringify(error)) : null;

  if (!errorText) return null;

  const isCancelled = status.reason === 'cancelled';
  const headerText = isCancelled ? 'Cancelled reason' : 'Error';

  return (
    <div
      data-slot="tool-fallback-error"
      data-testid="chat-tool-fallback-error"
      className={cn('aui-tool-fallback-error', className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header text-label font-semibold text-destructive mb-1">{headerText}</p>
      <p className="aui-tool-fallback-error-reason text-label text-muted-foreground">{errorText}</p>
    </div>
  );
}
