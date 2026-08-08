import { Play, Square, RefreshCw } from 'lucide-react';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';

interface PreviewRunControlProps {
  status: LaunchProcessStatus | null;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
}

/**
 * Primary run/stop control — the leftmost item of the preview toolbar.
 * Stopped/failed → a Run button; running or starting → Stop paired with a
 * Restart glyph. The hue rides the glyph, not the button fill: both states are
 * neutral `outline` buttons so neither shouts over the address bar.
 */
export function PreviewRunControl({ status, onRun, onStop, onRestart }: PreviewRunControlProps) {
  const stopped = status === null || status === 'stopped' || status === 'failed';

  if (stopped) {
    return (
      <Button data-testid="preview-run-start" variant="outline" size="xs" className="shrink-0" onClick={onRun}>
        <Play data-icon="inline-start" className="fill-current text-success" />
        Run
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-px">
      <Button data-testid="preview-run-stop" variant="outline" size="xs" onClick={onStop}>
        <Square data-icon="inline-start" className="fill-current text-destructive" />
        Stop
      </Button>
      <Hint label="Restart server">
        <Button
          data-testid="preview-run-restart"
          variant="ghost"
          size="icon-xs"
          aria-label="Restart server"
          onClick={onRestart}
        >
          <RefreshCw />
        </Button>
      </Hint>
    </div>
  );
}
