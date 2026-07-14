/**
 * DetailsRuns — every past run for an automation (todo #233's Runs tab),
 * newest first. Reuses `LastRunPill`'s status vocabulary and `RunView`'s
 * trigger-kind labels — one source of truth for both surfaces. Clicking a
 * row opens it in `RunView`.
 */
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';
import type { AutomationRunSummary } from '../contract';
import { RUN_STATUS_DOT_CLASS, RUN_STATUS_LABEL } from '../library/LastRunPill';
import { TRIGGER_LABEL } from '../run/run-trigger-label';

export interface DetailsRunsProps {
  runs: AutomationRunSummary[];
  onOpenRun: (runId: string) => void;
}

export function DetailsRuns({ runs, onOpenRun }: DetailsRunsProps) {
  if (runs.length === 0) {
    return (
      <div
        data-testid="automations-details-runs-empty"
        className="flex h-full flex-col items-center justify-center gap-[6px] px-[20px] py-[40px] text-center"
      >
        <span className="text-body text-muted-foreground">No runs yet.</span>
      </div>
    );
  }

  return (
    <div data-testid="automations-details-runs" className="flex flex-col">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          data-testid={`automations-details-run-${run.id}`}
          onClick={() => onOpenRun(run.id)}
          className="flex items-center gap-[10px] border-b border-border px-[20px] py-[11px] text-left hover:bg-accent"
        >
          <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', RUN_STATUS_DOT_CLASS[run.status])} />
          <span className="min-w-0 flex-1">
            <span className="block text-label font-medium text-foreground">{RUN_STATUS_LABEL[run.status]}</span>
            <span className="block text-caption text-muted-foreground">
              {TRIGGER_LABEL[run.trigger.kind]} · {formatRelativeTime(run.startedAt, Date.now())}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
