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
import { useState, useEffect } from 'react';
import { useHost } from '@/lib/host';
import { getToolResultContent } from '@/lib/api/chats';
import { cn } from '@/lib/utils';

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
}

type FetchState = 'idle' | 'loading' | 'error';

export function ToolResultExpand({ chatId, toolUseId, truncatedContent, fullBytes }: ToolResultExpandProps) {
  const host = useHost();
  const [full, setFull] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [port, setPort] = useState<number | null>(null);

  // Resolve the daemon port once on mount via the host port.
  useEffect(() => {
    host.daemon
      .port()
      .then(setPort)
      .catch((err: unknown) => {
        // Port is unavailable — expand will remain disabled until resolved.
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

  const buttonClass = cn(
    'text-caption text-muted-foreground hover:text-foreground',
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  );

  if (full !== null) {
    return (
      <div className="flex flex-col gap-1">
        <pre className="whitespace-pre-wrap break-words text-caption text-foreground">{full}</pre>
        <button
          data-testid="tool-result-expand-collapse"
          type="button"
          className={buttonClass}
          onClick={() => setFull(null)}
        >
          Collapse
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <pre className="whitespace-pre-wrap break-words text-caption text-muted-foreground">{truncatedContent}</pre>
      {fetchState === 'error' ? (
        <span className="text-caption text-muted-foreground opacity-70">full output no longer available</span>
      ) : (
        <button
          data-testid="tool-result-expand-toggle"
          type="button"
          disabled={fetchState === 'loading' || port == null}
          className={buttonClass}
          onClick={expand}
        >
          {fetchState === 'loading' ? 'Loading…' : `Show full output · ${fmtBytes(fullBytes)}`}
        </button>
      )}
    </div>
  );
}
