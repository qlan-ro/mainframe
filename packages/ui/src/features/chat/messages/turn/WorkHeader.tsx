/**
 * The turn's one work row (T1, T1b, T1e): how it ended, how long it took, what
 * it did, its agents and its failures. The whole row folds the turn; the two
 * counts open it on the step they count.
 */
import { useLayoutEffect } from 'react';
import { Check, ChevronRight, CircleStop, CircleX, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTurnDuration } from '../../format-step';
import type { Turn } from '../../view-model/turn/types';
import { NO_CHILDREN, childCounts, childGoing, type ChildCounts, type LiveChildren } from './live-children';
import { Spinner } from './RowGlyph';
import { useRevealStep } from './reveal-step';
import { useTurnActions, useTurnSelector } from './turn-context';
import { useRowAnchor } from './use-row-anchor';

export const workId = (turnKey: string) => `chat-work-${encodeURIComponent(turnKey)}`;

function EndGlyph({ turn, going }: { turn: Turn; going: boolean }) {
  if (turn.needsYou) return <ShieldAlert aria-hidden className="size-3.5 text-warning" />;
  if (turn.running || going) return <Spinner />;
  if (turn.end === 'stopped') return <CircleStop aria-hidden className="size-3.5 text-muted-foreground" />;
  if (turn.end === 'error') return <CircleX aria-hidden className="size-3.5 text-fail" />;
  return <Check aria-hidden className="size-3.5 text-mf-tr-ok" />;
}

function stateWord(turn: Turn, going: boolean): string {
  if (turn.needsYou) return 'Waiting on you';
  if (turn.running) return 'Running';
  if (going) return 'Still going';
  if (turn.end === 'stopped') return 'Stopped';
  return turn.end === 'error' ? 'Ended on an error' : 'Finished';
}

function title(turn: Turn): string {
  // The turn status row is the one live clock, so a running turn states no time.
  if (turn.needsYou) return 'Waiting on you';
  if (turn.running) return 'Working';
  return turn.durationMs === undefined ? 'Worked' : `Worked for ${formatTurnDuration(turn.durationMs)}`;
}

/** Steps that failed, and delegated tasks whose work did. */
function failedSteps(turn: Turn, live: LiveChildren): readonly string[] {
  const tasks = turn.children.filter((child) => live.failed.has(child.toolCallId));
  return [...turn.failed, ...tasks.map((child) => child.toolCallId)];
}

function failedText(turn: Turn, failed: readonly string[]): string {
  if (failed.length) return `${failed.length} failed`;
  return turn.retried.length ? `${turn.retried.length} failed, retried` : '';
}

function countsText(counts: ChildCounts): string {
  return [
    counts.who,
    counts.needsYou && `${counts.needsYou} need${counts.needsYou === 1 ? 's' : ''} you`,
    counts.running && `${counts.running} running`,
    counts.queued && `${counts.queued} queued`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const COUNT_CLASS =
  'mf-tr-meta relative -mr-0.5 h-6 shrink-0 rounded-md px-1.5 whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:focus-line-inset';

function AgentsCount({ turn, live }: { turn: Turn; live: LiveChildren }) {
  const reveal = useRevealStep(turn.key);
  const counts = childCounts(turn.children, live);
  if (!counts) return null;
  const going = turn.children.find((child) => childGoing(child, live));
  const first = going ?? turn.children[0]!;
  return (
    <button
      type="button"
      data-testid={`chat-work-agents-${encodeURIComponent(turn.key)}`}
      aria-label={`${countsText(counts)}: show ${going ? 'the ones still going' : 'them'}`}
      onClick={() => reveal(first.toolCallId, { open: false })}
      className={COUNT_CLASS}
    >
      {counts.who}
      {counts.needsYou > 0 && (
        <>
          {' · '}
          <span className="text-warning">
            {counts.needsYou} need{counts.needsYou === 1 ? 's' : ''} you
          </span>
        </>
      )}
      {counts.running > 0 && ` · ${counts.running} running`}
      {counts.queued > 0 && ` · ${counts.queued} queued`}
    </button>
  );
}

function FailedCount({ turn, failed }: { turn: Turn; failed: readonly string[] }) {
  const reveal = useRevealStep(turn.key);
  const text = failedText(turn, failed);
  if (!text) return null;
  const first = failed[0] ?? turn.retried[0]!;
  return (
    <button
      type="button"
      data-testid={`chat-work-failed-${encodeURIComponent(turn.key)}`}
      data-retried={failed.length === 0}
      aria-label={`${text}: show ${failed.length ? 'the failed step' : 'the step'}`}
      onClick={() => reveal(first, { open: true })}
      className={cn(COUNT_CLASS, failed.length > 0 && 'text-fail hover:bg-fail/6 hover:text-fail')}
    >
      {text}
    </button>
  );
}

export function WorkHeader({ turn }: { turn: Turn }) {
  const { toggle, register } = useTurnActions();
  const open = useTurnSelector((state) => state.open(turn.key), true);
  const live = useTurnSelector((state) => state.children, NO_CHILDREN);
  const { rowRef, beforeToggle } = useRowAnchor(open);
  useLayoutEffect(() => register(turn.key, beforeToggle), [register, turn.key, beforeToggle]);
  const going = turn.unfinished || turn.children.some((child) => childGoing(child, live));
  const counts = childCounts(turn.children, live);
  const failed = failedSteps(turn, live);
  const word = stateWord(turn, going);
  const name = [
    word === title(turn) ? word : `${word}: ${title(turn)}`,
    turn.summary,
    counts && countsText(counts),
    failedText(turn, failed),
  ];
  return (
    <div
      ref={rowRef}
      data-testid={`chat-work-header-${encodeURIComponent(turn.key)}`}
      data-work-end={turn.needsYou ? 'needs-you' : turn.running ? 'running' : turn.end}
      className="relative flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 text-sm text-muted-foreground"
    >
      <button
        type="button"
        data-testid={`chat-work-toggle-${encodeURIComponent(turn.key)}`}
        aria-label={name.filter(Boolean).join(', ')}
        aria-expanded={open}
        aria-controls={open ? workId(turn.key) : undefined}
        onClick={() => toggle(turn.key)}
        className="absolute inset-0 rounded-md hover:bg-muted/60 focus-visible:focus-line-inset"
      />
      <span className="pointer-events-none relative grid size-4 shrink-0 place-items-center">
        <EndGlyph turn={turn} going={going} />
      </span>
      <span className="pointer-events-none relative shrink-0 font-medium text-foreground">{title(turn)}</span>
      <span className="pointer-events-none relative min-w-0 flex-1 truncate">{turn.summary}</span>
      <AgentsCount turn={turn} live={live} />
      <FailedCount turn={turn} failed={failed} />
      <ChevronRight
        aria-hidden
        className={cn(
          'pointer-events-none relative size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
          open && 'rotate-90',
        )}
      />
    </div>
  );
}
