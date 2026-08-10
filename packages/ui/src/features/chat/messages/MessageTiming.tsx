'use client';

/**
 * MessageTiming — per-message duration + cost footer.
 *
 * Reads `metadata.timing.totalStreamTime` (← daemon turnDurationMs) and
 * `metadata.custom.mainframe.cost`. The daemon's WS protocol surfaces only the
 * total turn duration — no first-token / tokens-per-second — so those rows are
 * intentionally omitted. Hides when there is no duration.
 */
import type { FC } from 'react';
import { useMessageTiming } from '@assistant-ui/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMainframeMeta } from '../view-model/message-meta';
import { formatDurationMs } from '../format-duration';

function formatCostUsd(usd: number): string {
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* The tooltip inverts `foreground` into its fill, so the secondary ink
          has to be a tint of `background` — `muted-foreground` disappears on it. */}
      <span className="text-background/70">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

export interface MessageTimingProps {
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export const MessageTiming: FC<MessageTimingProps> = ({ className, side = 'top' }) => {
  const timing = useMessageTiming();
  const cost = useMainframeMeta().cost;
  const totalMs = timing?.totalStreamTime;

  if (totalMs === undefined) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="chat-message-timing"
          aria-label="Message timing"
          className={cn(
            'cursor-default rounded-sm px-1 py-0.5 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            className,
          )}
        >
          {formatDurationMs(totalMs)}
        </button>
      </TooltipTrigger>
      {/* The tooltip's own chrome (fill, radius, ink, padding) comes from the
          primitive; only the detail grid is this component's business. */}
      <TooltipContent side={side} sideOffset={6}>
        <div className="grid min-w-32 gap-1.5">
          <DetailRow label="Total" value={formatDurationMs(totalMs)} />
          {cost !== undefined && <DetailRow label="Cost" value={formatCostUsd(cost)} />}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
