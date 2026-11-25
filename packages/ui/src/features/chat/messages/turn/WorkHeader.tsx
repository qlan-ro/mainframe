/**
 * The turn's one work row (T1, T1b, T1e): how it ended, how long it took, what
 * it did, its agents and its failures. The whole row folds the turn; the two
 * counts open it on the step they count.
 */
import { useLayoutEffect } from 'react';
import { Check, ChevronRight, CircleStop, CircleX, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTurnDuration } from '../../format-step';
import type { PartState, Turn } from '../../view-model/turn/types';
import { NO_CHILDREN, childCounts, childGoing, turnState, type ChildCounts, type LiveChildren } from './live-children';
import { Spinner } from './RowGlyph';
import { useRevealStep } from './reveal-step';
import { useTurnActions, useTurnSelector } from './turn-context';
import { useRowAnchor } from './use-row-anchor';

export const workId = (turnKey: string) => `chat-work-${encodeURIComponent(turnKey)}`;

function EndGlyph({ state }: { state: PartState }) {
  switch (state) {
    case 'needs-you':
      return <ShieldAlert aria-hidden className="size-4 text-warning" />;
    case 'going':
      return <Spinner className="size-[13px]" />;
    case 'stopped':
      return <CircleStop aria-hidden className="size-4 text-muted-foreground" />;
    case 'error':
      return <CircleX aria-hidden className="size-4 text-fail" />;
    case 'finished':
      return <Check aria-hidden className="size-4 text-mf-tr-ok" />;
    case 'neutral':
      // Nothing says how it ended, so neither does the row.
      return <span aria-hidden className="size-1 rounded-full bg-muted-foreground" />;
  }
}

const STATE_WORDS: Record<PartState, string> = {
  'needs-you': 'Waiting on you',
  going: 'Still going',
  error: 'Ended on an error',
  stopped: 'Stopped',
  finished: 'Finished',
  neutral: '',
};

function title(turn: Turn): string {
  // The turn status row is the one live clock, so a running turn states no time.
  if (turn.evidence.needsYou) return STATE_WORDS['needs-you'];
  if (turn.running) return 'Working';
  return turn.durationMs === undefined ? 'Worked' : `Worked for ${formatTurnDuration(turn.durationMs)}`;
}

/** The row's name: its state, unless the visible title says it or nothing does. */
function named(turn: Turn, state: PartState): string {
  const word = state === 'going' && turn.running ? 'Running' : STATE_WORDS[state];
  return !word || word === title(turn) ? title(turn) : `${word}: ${title(turn)}`;
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
  'mf-tr-meta relative -mr-0.5 h-6 shrink-0 rounded-[6px] px-1.5 whitespace-nowrap text-(--mf-tr-muted) hover:bg-accent hover:text-foreground focus-visible:focus-line-inset';

/** What the count lands on, after "show". */
function shown(all: number, going: number): string {
  if (going) return going === 1 ? 'the one still going' : 'the ones still going';
  return all === 1 ? 'it' : 'them';
}

function AgentsCount({ turn, live }: { turn: Turn; live: LiveChildren }) {
  const reveal = useRevealStep(turn.key);
  const counts = childCounts(turn.children, live);
  if (!counts) return null;
  const going = turn.children.filter((child) => childGoing(child, live));
  const first = going[0] ?? turn.children[0]!;
  return (
    <button
      type="button"
      data-testid={`chat-work-agents-${encodeURIComponent(turn.key)}`}
      aria-label={`${countsText(counts)}: show ${shown(turn.children.length, going.length)}`}
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
      className={cn(COUNT_CLASS, failed.length > 0 && 'text-fail hover:bg-fail/10 hover:text-fail')}
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
  const state = turnState(turn, live);
  const counts = childCounts(turn.children, live);
  const failed = failedSteps(turn, live);
  const name = [named(turn, state), turn.summary, counts && countsText(counts), failedText(turn, failed)];
  return (
    <div
      ref={rowRef}
      data-testid={`chat-work-header-${encodeURIComponent(turn.key)}`}
      data-work-state={state}
      className="relative flex min-h-7 w-full min-w-0 items-center gap-2 rounded-[7px] px-1 text-sm/[22px] text-(--mf-tr-secondary) [--muted-foreground:var(--mf-tr-muted)]"
    >
      <button
        type="button"
        data-testid={`chat-work-toggle-${encodeURIComponent(turn.key)}`}
        aria-label={name.filter(Boolean).join(', ')}
        aria-expanded={open}
        aria-controls={open ? workId(turn.key) : undefined}
        onClick={() => toggle(turn.key)}
        className="absolute inset-0 rounded-[7px] hover:bg-(--mf-tr-hover) focus-visible:focus-line-inset"
      />
      <span className="pointer-events-none relative grid size-4 shrink-0 place-items-center">
        <EndGlyph state={state} />
      </span>
      <span className="pointer-events-none relative shrink-0 font-medium text-(--mf-tr-ink)">{title(turn)}</span>
      <span className="pointer-events-none relative min-w-0 flex-1 truncate text-(--mf-tr-muted)">{turn.summary}</span>
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
