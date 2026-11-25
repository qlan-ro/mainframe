/**
 * The line under a message (T1b): its time beside Copy, Fork and More. It shows
 * on hover or keyboard focus and keeps its height, so nothing moves. The
 * tooltip has the full date, and for an agent's reply what it took.
 */
import { useAuiState, useMessageTiming } from '@assistant-ui/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatTurnDuration } from '../format-step';
import { useMainframeMeta } from '../view-model/message-meta';
import { MessageActionBar } from './MessageActionBar';
import { useTurnSelector } from './turn/turn-context';

function formatCostUsd(usd: number): string {
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export const formatClock = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** What the turn took, which its provider may say on another of its messages. */
function useTook(): { totalMs?: number; cost?: number } {
  const id = useAuiState((s) => s.message.id);
  const turn = useTurnSelector(({ model }) => {
    const key = model.slices.get(id)?.turnKey;
    return key === undefined ? undefined : model.turns.get(key);
  }, undefined);
  const ownMs = useMessageTiming()?.totalStreamTime;
  const ownCost = useMainframeMeta().cost;
  return { totalMs: turn?.durationMs ?? ownMs, cost: turn?.costUsd ?? ownCost };
}

export function MessageTime() {
  const createdAt = useAuiState((s) => s.message.createdAt as Date | undefined);
  const { totalMs, cost } = useTook();
  if (!createdAt) return null;
  const date = createdAt.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={createdAt.toISOString()}
          data-testid="chat-message-timestamp"
          // The date, duration and cost are in its tooltip, which focus opens too.
          tabIndex={0}
          className="mf-tr-meta rounded-md px-1 text-muted-foreground tabular-nums focus-visible:focus-line"
        >
          {formatClock(createdAt)}
        </time>
      </TooltipTrigger>
      <TooltipContent data-testid="chat-message-time-detail" className="flex-col items-start gap-0.5">
        <span>{date}</span>
        {totalMs !== undefined && totalMs > 0 && <span>Took {formatTurnDuration(totalMs)}</span>}
        {cost !== undefined && <span>Cost {formatCostUsd(cost)}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export function MessageFooter({ user = false }: { user?: boolean }) {
  return (
    <div
      data-testid="chat-message-footer"
      className={cn('mf-tr-footer mt-1 flex h-6 items-center gap-0.5', user && 'justify-end')}
    >
      {!user && <MessageTime />}
      <MessageActionBar user={user} />
      {user && <MessageTime />}
    </div>
  );
}
