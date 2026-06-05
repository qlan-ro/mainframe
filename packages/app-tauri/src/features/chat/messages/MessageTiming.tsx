'use client';

/**
 * MessageTiming — per-message timing + cost footer.
 *
 * Reads:
 *  - metadata.timing.totalStreamTime  ← projected from daemon's turnDurationMs
 *  - metadata.custom.mainframe.cost   ← session cost written by daemon pipeline
 *
 * Renders a compact badge (total time) with a tooltip that expands to show
 * First-token time (when present) and Cost (when present). Hides itself when
 * totalStreamTime is absent — matches the native MessageTiming contract.
 *
 * Placed standalone; the orchestrator wires it into AssistantMessage's footer.
 * Wrapped in TooltipProvider so it works outside a provider tree.
 */

import type { FC } from 'react';
import { useMessageTiming, useAuiState } from '@assistant-ui/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ── Formatters ───────────────────────────────────────────────────────────────

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCostUsd(usd: number): string {
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

// ── Cost from custom metadata ────────────────────────────────────────────────

function useCostUsd(): number | undefined {
  return useAuiState((s) => {
    const custom = s.message.metadata?.custom as { mainframe?: { cost?: unknown } } | undefined;
    const raw = custom?.mainframe?.cost;
    return typeof raw === 'number' ? raw : undefined;
  });
}

// ── Tooltip detail row ───────────────────────────────────────────────────────

interface DetailRowProps {
  label: string;
  value: string;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface MessageTimingProps {
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export const MessageTiming: FC<MessageTimingProps> = ({ className, side = 'top' }) => {
  const timing = useMessageTiming();
  const costUsd = useCostUsd();

  // Nothing to show if the stream hasn't completed.
  if (timing?.totalStreamTime === undefined) return null;

  const hasCost = costUsd !== undefined;
  const hasFirstToken = timing.firstTokenTime !== undefined;
  const hasSpeed = timing.tokensPerSecond !== undefined;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="chat-message-timing"
            aria-label="Message timing"
            className={cn(
              'rounded-sm px-1 py-0.5',
              'font-mono text-micro tabular-nums',
              'text-mf-text-4 hover:text-mf-text-3',
              'hover:bg-accent transition-colors',
              'cursor-default',
              className,
            )}
          >
            {formatMs(timing.totalStreamTime)}
          </button>
        </TooltipTrigger>

        <TooltipContent
          side={side}
          sideOffset={6}
          className={cn(
            'bg-popover text-popover-foreground',
            'rounded-lg border border-border px-3 py-2',
            'shadow-[var(--mf-shadow-pop)]',
          )}
        >
          <div className="grid min-w-36 gap-1.5 text-caption">
            {hasFirstToken && <DetailRow label="First token" value={formatMs(timing.firstTokenTime)} />}

            <DetailRow label="Total" value={formatMs(timing.totalStreamTime)} />

            {hasSpeed && <DetailRow label="Speed" value={`${timing.tokensPerSecond!.toFixed(1)} tok/s`} />}

            {hasCost && <DetailRow label="Cost" value={formatCostUsd(costUsd)} />}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
