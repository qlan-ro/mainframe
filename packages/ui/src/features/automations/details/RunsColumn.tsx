/**
 * RunsColumn — Details' second-level sidebar (2026-10 redesign, superseding
 * the old Runs/Overview tab switch): every run for the open automation,
 * newest first, with "Overview" pinned above them. Selecting a row drives
 * the body (`AutomationDetails`) between `DetailsOverview` and that run's
 * trace (`run/RunTrace`) — this component only renders the list and reports
 * clicks; it owns no navigation state of its own.
 */
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';
import type { AutomationRunSummary } from '../contract';
import { RUN_STATUS_DOT_CLASS, RUN_STATUS_LABEL } from '../library/LastRunPill';
import { formatDuration } from '../run/run-timeline';

function RunGlyph({ status }: { status: AutomationRunSummary['status'] }) {
  if (status === 'running') {
    return (
      <span
        aria-hidden
        className="size-[8px] shrink-0 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent"
      />
    );
  }
  return <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', RUN_STATUS_DOT_CLASS[status])} />;
}

function RunRow({ run, selected, onSelect }: { run: AutomationRunSummary; selected: boolean; onSelect: () => void }) {
  const duration = formatDuration(run.startedAt, run.finishedAt ?? undefined);
  return (
    <button
      type="button"
      data-testid={`automations-runs-row-${run.id}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-[8px] rounded-md px-[10px] py-[7px] text-left text-xs hover:bg-accent',
        selected && 'bg-sidebar-selection',
      )}
    >
      <Hint label={RUN_STATUS_LABEL[run.status]}>
        <RunGlyph status={run.status} />
      </Hint>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{formatRelativeTime(run.startedAt, Date.now())}</span>
        {duration && <span className="block text-muted-foreground">{duration}</span>}
      </span>
    </button>
  );
}

export interface RunsColumnProps {
  runs: AutomationRunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string | null) => void;
}

export function RunsColumn({ runs, selectedRunId, onSelect }: RunsColumnProps) {
  return (
    <div
      data-testid="automations-runs-column"
      className="flex h-full w-[240px] shrink-0 flex-col gap-[2px] overflow-y-auto border-l border-border bg-background p-[8px]"
    >
      <button
        type="button"
        data-testid="automations-runs-overview"
        aria-pressed={selectedRunId == null}
        onClick={() => onSelect(null)}
        className={cn(
          'rounded-md px-[10px] py-[7px] text-left text-xs font-medium text-foreground hover:bg-accent',
          selectedRunId == null && 'bg-sidebar-selection',
        )}
      >
        Overview
      </button>
      {runs.length === 0 ? (
        <div data-testid="automations-runs-empty" className="px-[10px] py-[7px] text-xs text-muted-foreground">
          No runs yet
        </div>
      ) : (
        runs.map((run) => (
          <RunRow key={run.id} run={run} selected={run.id === selectedRunId} onSelect={() => onSelect(run.id)} />
        ))
      )}
    </div>
  );
}
