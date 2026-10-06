/**
 * PairGlyph — the trailing glyph slot of a task card.
 *
 * An unpaired task shows a hover-revealed publish action; a paired one shows its
 * issue number, amber whenever a person should look (overwritten in the last run,
 * errored, or remotely unlinked). Ordinary sync activity is never amber.
 *
 * The pair is read from the sync store by `todo.id` — the pairing key is never
 * the reusable board number — so the card grows no prop for it.
 *
 * Board-only since the 2026-10 redesign (the list view's row variant is gone);
 * the `tasks-card-*` prefix is no longer a choice between two surfaces.
 */
import React from 'react';
import { CircleDotDashed, TriangleAlert, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import type { Todo } from '@/lib/api/todos';
import type { Pair } from '@/lib/api/todos-github';
import { useGitHubSyncStore } from './use-github-sync-store';

interface Props {
  todo: Todo;
}

const PREFIX = 'tasks-card';

const AMBER_STATES: ReadonlySet<Pair['pairState']> = new Set(['overwritten', 'errored', 'remotely-unlinked']);

/** Icon and hover reason for a paired glyph — clean pairs carry neither. */
function pairedAffordance(pair: Pair): { icon: React.ReactNode; hint: string } {
  switch (pair.pairState) {
    case 'overwritten':
      return {
        icon: <span className="size-1.5 rounded-full bg-warning shrink-0" aria-hidden />,
        hint: 'Overwritten in the last run — open the report',
      };
    case 'errored':
      return { icon: <TriangleAlert size={12} aria-hidden />, hint: pair.stateReason ?? 'Errored in the last run' };
    case 'remotely-unlinked':
      return { icon: <Unlink size={12} aria-hidden />, hint: pair.stateReason ?? 'The issue is gone from GitHub' };
    default:
      return { icon: null, hint: `Paired with issue #${pair.issueNumber}` };
  }
}

function PublishAction({
  todo,
  openDialog,
}: {
  todo: Todo;
  openDialog: (dialog: { kind: 'publish'; todo: Todo }) => void;
}): React.ReactElement {
  return (
    <Hint label="Publish to GitHub">
      <button
        type="button"
        data-testid={`${PREFIX}-publish-${todo.number}`}
        onClick={(e) => {
          e.stopPropagation();
          openDialog({ kind: 'publish', todo });
        }}
        aria-label="Publish to GitHub"
        className={cn(
          'shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-all',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <CircleDotDashed size={14} />
      </button>
    </Hint>
  );
}

export function PairGlyph({ todo }: Props): React.ReactElement | null {
  const { pairs, openDialog } = useGitHubSyncStore();
  const pair = pairs[todo.id];

  if (pair === undefined) return <PublishAction todo={todo} openDialog={openDialog} />;

  const amber = AMBER_STATES.has(pair.pairState);
  const { icon, hint } = pairedAffordance(pair);
  const opensReport = pair.pairState === 'overwritten';

  const body = (
    <>
      {icon}
      <span className="font-mono">#{pair.issueNumber}</span>
    </>
  );
  const className = cn(
    'shrink-0 inline-flex items-center gap-1 text-xs leading-4 px-1 py-0.5 rounded',
    amber ? 'text-warning' : 'text-muted-foreground',
    opensReport && 'hover:bg-accent transition-colors',
  );

  return (
    <Hint label={hint}>
      {opensReport ? (
        <button
          type="button"
          data-testid={`${PREFIX}-pair-${todo.number}`}
          data-amber="true"
          onClick={(e) => {
            e.stopPropagation();
            openDialog({ kind: 'report' });
          }}
          aria-label={`Issue #${pair.issueNumber} was overwritten — open the sync report`}
          className={className}
        >
          {body}
        </button>
      ) : (
        <span
          data-testid={`${PREFIX}-pair-${todo.number}`}
          data-amber={amber ? 'true' : undefined}
          className={className}
        >
          {body}
        </span>
      )}
    </Hint>
  );
}
