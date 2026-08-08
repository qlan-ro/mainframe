import { ArrowUp, Crosshair, Camera, Frame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

interface PreviewCaptureClusterProps {
  isRunning: boolean;
  inspectActive: boolean;
  regionActive: boolean;
  onCaptureClick: () => void;
  onRegionClick: () => void;
  onInspectClick: () => void;
}

/**
 * Inspect and Region are `Toggle`s; their pressed chrome is driven from the
 * state prop, not `data-[state=on]` — a Hint wraps each one, and
 * `TooltipTrigger asChild` overwrites the child's `data-state` with the
 * tooltip's own.
 */
const TOGGLE_SIZE = "size-6 min-w-6 p-0 [&_svg:not([class*='size-'])]:size-3";
const TOGGLE_ON = 'bg-accent text-primary';

export function PreviewCaptureCluster({
  isRunning,
  inspectActive,
  regionActive,
  onCaptureClick,
  onRegionClick,
  onInspectClick,
}: PreviewCaptureClusterProps) {
  return (
    <div
      data-testid="preview-capture-cluster"
      className={cn(
        'flex shrink-0 items-center gap-px rounded-md py-px pr-1 pl-2',
        isRunning ? 'border border-primary/20 bg-primary/5' : 'pointer-events-none opacity-40',
      )}
    >
      <ArrowUp className="size-3 text-primary" aria-hidden />
      <span className="mr-0.5 text-xs font-medium text-primary">Chat</span>

      <Hint label="Inspect element">
        <Toggle
          data-testid="preview-toolbar-inspect"
          aria-label="Inspect element"
          pressed={inspectActive}
          onPressedChange={() => onInspectClick()}
          className={cn(TOGGLE_SIZE, inspectActive ? TOGGLE_ON : 'text-muted-foreground')}
        >
          <Crosshair />
        </Toggle>
      </Hint>

      <Hint label="Capture screenshot">
        <Button
          data-testid="preview-toolbar-capture"
          variant="ghost"
          size="icon-xs"
          aria-label="Capture screenshot"
          onClick={onCaptureClick}
        >
          <Camera />
        </Button>
      </Hint>

      <Hint label="Capture region">
        <Toggle
          data-testid="preview-toolbar-region"
          aria-label="Capture region"
          pressed={regionActive}
          onPressedChange={() => onRegionClick()}
          className={cn(TOGGLE_SIZE, regionActive ? TOGGLE_ON : 'text-muted-foreground')}
        >
          <Frame />
        </Toggle>
      </Hint>
    </div>
  );
}
