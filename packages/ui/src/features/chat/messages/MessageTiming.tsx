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

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatCostUsd(usd: number): string {
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
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
            'cursor-default rounded-sm px-1 py-0.5 font-mono text-caption tabular-nums text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground',
            className,
          )}
        >
          {formatMs(totalMs)}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-[var(--mf-shadow-pop)]"
      >
        <div className="grid min-w-32 gap-1.5 text-caption">
          <DetailRow label="Total" value={formatMs(totalMs)} />
          {cost !== undefined && <DetailRow label="Cost" value={formatCostUsd(cost)} />}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
