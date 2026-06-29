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
}

export function PreviewBodyState({
  status,
  configName,
  port,
  device,
  inspectActive,
  anchorRef,
  onStart,
}: PreviewBodyStateProps) {
  if (status === null || status === 'stopped') {
    return (
      <div data-testid="preview-body-stopped" className="absolute inset-0 grid place-items-center bg-card">
        <button
          type="button"
          data-testid="preview-body-cta"
          onClick={onStart}
          className="group flex flex-col items-center gap-2.5 px-[26px] py-[20px] rounded-xl border-none bg-transparent cursor-pointer hover:bg-accent transition-colors"
        >
          <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center transition-[border-color] duration-[120ms] group-hover:border-mf-success">
            <Play size={15} className="fill-current text-mf-success" />
          </div>
          <span className="text-label text-muted-foreground font-medium tracking-tight">
            Run {configName || 'server'}
          </span>
          <span className="font-mono text-micro text-mf-text-4">launches localhost:{port ?? '…'}</span>
        </button>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div data-testid="preview-body-starting" className="absolute inset-0 grid place-items-center bg-card">
        <div className="flex items-center gap-[8px]">
          <Loader2 size={12} className="animate-spin text-mf-text-3" />
          <span className="text-label text-mf-text-3">Waiting for localhost:{port ?? '…'}…</span>
        </div>
      </div>
    );
  }

  if (status === 'running') {
    const inspectFrame = inspectActive ? 'outline outline-[2px] outline-primary -outline-offset-2' : '';
    const inspectBadge = inspectActive ? (
      <div
        data-testid="preview-inspect-active-indicator"
        className="absolute top-[8px] left-[8px] z-10 rounded-[6px] bg-primary px-[7px] py-[2px] font-mono text-micro font-bold text-white"
      >
        CLICK AN ELEMENT
      </div>
    ) : null;
    return (
      <div data-testid="preview-body-running" className="absolute inset-0">
        {device === 'desktop' ? (
          <div
            className={`absolute inset-0 overflow-hidden rounded-md [border:0.5px_solid_var(--border)] ${inspectFrame}`}
          >
            <div ref={anchorRef} className="absolute inset-0" />
            {inspectBadge}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div
              className={`relative w-[230px] h-[420px] overflow-hidden rounded-[22px] [border:0.5px_solid_var(--border)] [box-shadow:var(--mf-shadow-pop)] ${inspectFrame}`}
            >
              <div ref={anchorRef} className="w-full h-full" />
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
        <span className="w-2 h-2 rounded-full bg-destructive mr-2" />
        <span className="text-body text-muted-foreground">Failed to start</span>
      </div>
    </div>
  );
}
