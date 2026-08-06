import type { RefObject } from 'react';
import { Play, Loader2 } from 'lucide-react';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

interface PreviewBodyStateProps {
  status: LaunchProcessStatus | null;
  configName?: string;
  port?: number | null;
  device: 'desktop' | 'mobile';
  inspectActive: boolean;
  anchorRef: RefObject<HTMLDivElement | null>;
  onStart: () => void;
  /** Remote-daemon preview: status is 'running' but the tunnel URL hasn't arrived yet. */
  tunnelPending?: boolean;
  /** Remote-daemon preview: the Cloudflare tunnel errored out or timed out. Wins over `running`. */
  tunnelFailed?: boolean;
  tunnelError?: string | null;
}

export function PreviewBodyState({
  status,
  configName,
  port,
  device,
  inspectActive,
  anchorRef,
  onStart,
  tunnelPending,
  tunnelFailed,
  tunnelError,
}: PreviewBodyStateProps) {
  // Checked before `tunnelPending` — `usePreviewLifecycle` reports pending
  // whenever there's no resolved URL yet, which is also true once the tunnel
  // has failed. Failure is the more terminal state and wins. Also wins over
  // `running` — status IS 'running' while the tunnel is down, but the
  // webview area has nothing to mount without a resolved URL.
  if (tunnelFailed) {
    return (
      <div data-testid="preview-body-tunnel-failed" className="absolute inset-0 grid place-items-center bg-card">
        <div className="flex max-w-[80%] flex-col items-center gap-2.5 text-center">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-destructive" />
            <span className="text-sm text-muted-foreground">Preview tunnel unavailable</span>
          </div>
          {tunnelError && <span className="line-clamp-2 font-mono text-xs text-muted-foreground">{tunnelError}</span>}
          <span className="text-xs text-muted-foreground">Process logs are in the console below</span>
        </div>
      </div>
    );
  }

  if (tunnelPending) {
    return (
      <div data-testid="preview-tunnel-pending" className="absolute inset-0 grid place-items-center bg-card">
        <div className="flex items-center gap-2">
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Starting tunnel…</span>
        </div>
      </div>
    );
  }

  if (status === null || status === 'stopped') {
    return (
      <div data-testid="preview-body-stopped" className="absolute inset-0 grid place-items-center bg-card">
        <button
          type="button"
          data-testid="preview-body-cta"
          onClick={onStart}
          className="group flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-none bg-transparent px-6 py-5 transition-colors hover:bg-muted"
        >
          <div className="flex size-10 items-center justify-center rounded-full border border-border transition-colors group-hover:border-success">
            <Play className="size-4 fill-current text-success" />
          </div>
          <span className="text-xs font-medium tracking-tight text-muted-foreground">Run {configName || 'server'}</span>
          <span className="font-mono text-xs text-muted-foreground">launches localhost:{port ?? '…'}</span>
        </button>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div data-testid="preview-body-starting" className="absolute inset-0 grid place-items-center bg-card">
        <div className="flex items-center gap-2">
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Waiting for localhost:{port ?? '…'}…</span>
        </div>
      </div>
    );
  }

  if (status === 'running') {
    const inspectFrame = inspectActive ? 'outline outline-[2px] outline-primary -outline-offset-2' : '';
    const inspectBadge = inspectActive ? (
      <div
        data-testid="preview-inspect-active-indicator"
        className="absolute top-2 left-2 z-10 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-xs font-semibold text-primary-foreground"
      >
        Click an element
      </div>
    ) : null;
    return (
      <div data-testid="preview-body-running" className="absolute inset-0">
        {device === 'desktop' ? (
          <div className={`absolute inset-0 overflow-hidden rounded-md border border-border ${inspectFrame}`}>
            <div ref={anchorRef} className="absolute inset-0" />
            {inspectBadge}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div
              className={`relative h-[420px] w-[230px] overflow-hidden rounded-[22px] border border-border shadow-md ${inspectFrame}`}
            >
              <div ref={anchorRef} className="size-full" />
              {inspectBadge}
            </div>
          </div>
        )}
      </div>
    );
  }

  // status === 'failed'
  return (
    <div data-testid="preview-body-failed" className="absolute inset-0 grid place-items-center bg-card">
      <div className="flex items-center">
        <span className="mr-2 size-2 rounded-full bg-destructive" />
        <span className="text-sm text-muted-foreground">Failed to start</span>
      </div>
    </div>
  );
}
