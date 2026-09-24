/**
 * ActivityOutputTail — the detail view's output section: loading, lines
 * (scrolled to the end), empty, none, or error, plus an on-demand Refresh.
 * An agent row renders only the transcript note, with no Refresh control
 * (AC22) — the tail is never requested for it.
 */
import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { OutputTailState } from './use-output-tail';

export interface ActivityOutputTailProps {
  taskId: string;
  tail: OutputTailState;
  onRefresh: () => void;
}

export function ActivityOutputTail({ taskId, tail, onRefresh }: ActivityOutputTailProps) {
  const linesRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (tail.kind === 'lines' && linesRef.current) {
      linesRef.current.scrollTop = linesRef.current.scrollHeight;
    }
  }, [tail]);

  if (tail.kind === 'transcript') {
    return (
      <p data-testid={`activity-output-transcript-${taskId}`} className="text-xs text-muted-foreground">
        This agent's output is its transcript, which isn't shown here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Output</span>
        <button
          type="button"
          data-testid={`activity-output-refresh-${taskId}`}
          aria-label="Refresh output"
          onClick={onRefresh}
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
        >
          <RefreshCw className="size-3" aria-hidden />
        </button>
      </div>
      {tail.kind === 'loading' && <p className="text-xs text-muted-foreground">Loading…</p>}
      {tail.kind === 'lines' && (
        <pre
          ref={linesRef}
          data-testid={`activity-output-lines-${taskId}`}
          className="max-h-40 overflow-y-auto rounded-md bg-foreground/5 p-2 font-mono text-xs whitespace-pre-wrap break-words"
        >
          {tail.text}
        </pre>
      )}
      {tail.kind === 'empty' && (
        <p data-testid={`activity-output-empty-${taskId}`} className="text-xs text-muted-foreground">
          No output yet.
        </p>
      )}
      {tail.kind === 'none' && (
        <p data-testid={`activity-output-none-${taskId}`} className="text-xs text-muted-foreground">
          No output.
        </p>
      )}
      {tail.kind === 'error' && (
        <p data-testid={`activity-output-error-${taskId}`} className="text-xs text-destructive">
          {tail.message}
        </p>
      )}
    </div>
  );
}
