'use client';

/**
 * ToolResultExpand — on-demand "show full output" for truncated tool results.
 *
 * The daemon truncates large tool outputs and exposes the full content via
 * GET /api/chats/:chatId/tool-result/:toolUseId. This component renders the
 * truncated preview and fetches the full text when the user requests it.
 *
 * Port contract (read port via host.daemon.port() from the host port — the
 * same async call every other app-tauri API call uses; no new global).
 *
 * Props accept chatId/toolUseId explicitly so the component can be used
 * anywhere in the tool-card tree without requiring a full ChatRuntime.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { useHost } from '@/lib/host';
import { getToolResultContent } from '@/lib/api/chats';
import { cn } from '@/lib/utils';
import { useRetainedValue } from '@/components/ui/disclosure-state';

// ---------------------------------------------------------------------------
// Byte formatter (shared with the collapse state)
// ---------------------------------------------------------------------------

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

// ---------------------------------------------------------------------------
// ToolResultExpand
// ---------------------------------------------------------------------------

export interface ToolResultExpandProps {
  chatId: string;
  toolUseId: string;
  truncatedContent: string;
  fullBytes: number;
  renderOutput?: (content: string) => ReactNode;
}

type FetchState = 'idle' | 'loading' | 'error';

export function ToolResultExpand({
  chatId,
  toolUseId,
  truncatedContent,
  fullBytes,
  renderOutput,
}: ToolResultExpandProps) {
  const host = useHost();
  const [full, setFull] = useRetainedValue<string | null>(`full-output:${chatId}:${toolUseId}`, null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [port, setPort] = useState<number | null>(null);

  useEffect(() => {
    host.daemon
      .port()
      .then(setPort)
      .catch((err: unknown) => {
        console.warn('[tool-result-expand] getDaemonPort failed', err);
      });
  }, [host]);

  const expand = async () => {
    if (port == null) return;
    setFetchState('loading');
    try {
      const content = await getToolResultContent(port, chatId, toolUseId);
      setFull(content);
      setFetchState('idle');
    } catch (err: unknown) {
      console.warn('[tool-result-expand] fetch failed', err);
      setFetchState('error');
    }
  };

  return full === null ? (
    <ToolResultPreview
      output={
        renderOutput?.(truncatedContent) ?? (
          <pre className="text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">{truncatedContent}</pre>
        )
      }
      state={fetchState}
      disabled={port === null}
      fullBytes={fullBytes}
      onExpand={expand}
      terminal={Boolean(renderOutput)}
    />
  ) : (
    <ExpandedToolResult
      output={
        renderOutput?.(full) ?? (
          <pre className="text-xs wrap-break-word whitespace-pre-wrap text-foreground">{full}</pre>
        )
      }
      onCollapse={() => setFull(null)}
    />
  );
}

const buttonClass = cn(
  'text-xs text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50',
);

function ExpandedToolResult({ output, onCollapse }: { output: ReactNode; onCollapse: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      {output}
      <button data-testid="tool-result-expand-collapse" type="button" className={buttonClass} onClick={onCollapse}>
        Collapse
      </button>
    </div>
  );
}

function ToolResultPreview({
  output,
  state,
  disabled,
  fullBytes,
  onExpand,
  terminal,
}: {
  output: ReactNode;
  state: FetchState;
  disabled: boolean;
  fullBytes: number;
  onExpand: () => void;
  terminal: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {output}
      {state === 'error' ? (
        <span className="text-xs text-muted-foreground">full output no longer available</span>
      ) : (
        <button
          data-testid="tool-result-expand-toggle"
          type="button"
          disabled={state === 'loading' || disabled}
          className={cn(
            buttonClass,
            terminal &&
              '-ml-1.5 h-6 self-start rounded-md px-1.5 text-[12px] hover:bg-muted focus-visible:focus-line-inset',
          )}
          onClick={onExpand}
        >
          {state === 'loading' ? 'Loading…' : `Show full output · ${fmtBytes(fullBytes)}`}
        </button>
      )}
    </div>
  );
}
