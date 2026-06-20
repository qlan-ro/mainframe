import { Play, Square, RotateCw } from 'lucide-react';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { PreviewIconButton } from './PreviewIconButton';

interface PreviewRunControlProps {
  status: LaunchProcessStatus | null;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
}

/**
 * Primary run/stop control — the leftmost item of the preview toolbar, mirroring
 * the prototype `PrimaryRun`. Stopped/failed → a green Run button; running or
 * starting → a Stop button paired with a Restart glyph.
 */
export function PreviewRunControl({ status, onRun, onStop, onRestart }: PreviewRunControlProps) {
  const stopped = status === null || status === 'stopped' || status === 'failed';

  if (stopped) {
    return (
      <button
        data-testid="preview-run-start"
        onClick={onRun}
        className="inline-flex h-[24px] flex-shrink-0 items-center gap-1.5 rounded-md bg-mf-success pl-[9px] pr-[11px] text-label font-semibold text-white"
      >
        <Play size={11} className="fill-current" />
        Run
      </button>
    );
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-px">
      <button
        data-testid="preview-run-stop"
        title="Stop"
        onClick={onStop}
        className="inline-flex h-[24px] items-center gap-1.5 rounded-md border-[0.5px] border-border bg-card pl-[8px] pr-[10px] text-label font-semibold text-foreground"
      >
        <Square size={10} className="fill-current text-destructive" />
        Stop
      </button>
      <PreviewIconButton testId="preview-run-restart" title="Restart" onClick={onRestart} className="w-[24px]">
        <RotateCw size={13} />
      </PreviewIconButton>
    </div>
  );
}
