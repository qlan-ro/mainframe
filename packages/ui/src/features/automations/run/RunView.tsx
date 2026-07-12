/**
 * RunView — header (name, trigger · time, status pill, Run again, Cancel) +
 * timeline (ts153 wf2-runtime.jsx `WfRunView`). Self-sufficient like
 * `AutomationEditor`: reads `runId` from `use-automations-nav` and
 * `runs`/`definitions`/`interactions`/`catalog`/`gateway` from
 * `use-automations-store` directly rather than taking props.
 *
 * `AutomationRunSummary` carries no step-by-step detail (contract §2's
 * checkpoint isn't a REST shape yet) — the timeline is fetched separately,
 * on demand, via `gateway.getRunTimeline` and kept as local state (not
 * store state: it's run-specific detail no other surface needs, mirroring
 * how `LibraryRow` keeps its own transient `running`/`toggling` flags
 * local). Only TOP-LEVEL entries (no `#` in `stepRef`) map to a row here —
 * Repeat fan-out entries are nested by `RunStepRow`/`RunRepeatGroup`
 * themselves.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Play, Square, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { mfToast } from '@/lib/toast';
import { openSessionById } from '@/lib/session-nav';
import type { AutomationRunSummary, AutomationRunTriggerKind, AutomationTimelineEntry } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { RUN_STATUS_DOT_CLASS, RUN_STATUS_LABEL } from '../library/LastRunPill';
import { RunStepRow } from './RunStepRow';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';

const TRIGGER_LABEL: Record<AutomationRunTriggerKind, string> = {
  schedule: 'Schedule',
  event: 'Event',
  webhook: 'Webhook',
  manual: 'Manual',
};

/** Background tint per run status — the hue lives on this tint + the dot, never on the label text (typography audit §1). */
const RUN_STATUS_BG_CLASS: Record<AutomationRunSummary['status'], string> = {
  running: 'bg-primary/10',
  waiting: 'bg-mf-warning/12',
  succeeded: 'bg-mf-success/12',
  failed: 'bg-destructive/10',
  cancelled: 'bg-muted',
};

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function isTopLevel(entry: AutomationTimelineEntry): boolean {
  return !entry.stepRef.includes('#');
}

export function RunView() {
  const runId = useAutomationsNav((s) => s.runId);
  const closeRun = useAutomationsNav((s) => s.closeRun);
  const openRun = useAutomationsNav((s) => s.openRun);
  const definitions = useAutomationsStore((s) => s.definitions);
  const runs = useAutomationsStore((s) => s.runs);
  const interactions = useAutomationsStore((s) => s.interactions);
  const catalog = useAutomationsStore((s) => s.catalog);
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchRun = useAutomationsStore((s) => s.patchRun);

  const run = runs.find((r) => r.id === runId);
  const automation = run ? definitions.find((d) => d.id === run.automationId) : undefined;

  const [timeline, setTimeline] = useState<AutomationTimelineEntry[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);

  const refetchTimeline = useCallback(
    async (targetRunId: string) => {
      try {
        setTimeline(await gateway.getRunTimeline(targetRunId));
      } catch (err) {
        mfToast.error('Could not load the run timeline', { description: errorMessage(err) });
      }
    },
    [gateway],
  );

  // Phase 6 live wiring: keyed on run?.id AND run?.status (a primitive, not the whole `run`
  // object) — a fresh id means "navigated to a different run" (refetch from empty); an
  // unchanged id whose status changed means a live `automation.run.updated` WS event patched
  // this same run (use-automation-events.ts → patchRun) while the view was open, so the
  // timeline is stale and needs the same refetch. Status is the right granularity: every
  // meaningful step transition ends in a run-level status change (running → waiting/succeeded/
  // failed/cancelled), and keying on it (not `run` itself) avoids re-fetching on unrelated
  // patches that don't change status.
  useEffect(() => {
    if (!run) return;
    void refetchTimeline(run.id);
  }, [run?.id, run?.status]);

  async function handleRunAgain() {
    if (!run || starting) return;
    setStarting(true);
    try {
      const next: AutomationRunSummary = await gateway.startRun(run.automationId);
      patchRun(next);
      openRun(next.id);
    } catch (err) {
      mfToast.error('Could not start the run', { description: errorMessage(err) });
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    if (!run || cancelling) return;
    setCancelling(true);
    try {
      await gateway.cancelRun(run.id);
      patchRun(await gateway.getRun(run.id));
    } catch (err) {
      mfToast.error('Could not cancel the run', { description: errorMessage(err) });
    } finally {
      setCancelling(false);
    }
  }

  if (!run) {
    return (
      <div
        data-testid="automations-run-not-found"
        className="flex h-full items-center justify-center text-body text-muted-foreground"
      >
        This run couldn't be found.
      </div>
    );
  }

  const cancellable = run.status === 'running' || run.status === 'waiting';
  const topLevel = timeline.filter(isTopLevel);

  return (
    <div data-testid="automations-run-view" className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-3.5">
        <Hint label="Back">
          <button
            type="button"
            data-testid="automations-run-back"
            onClick={closeRun}
            className="flex size-[30px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
        </Hint>
        <div className="min-w-0 flex-1">
          <div className="truncate text-heading font-bold tracking-tight text-foreground">
            {automation?.name ?? 'Automation'}
          </div>
          <div className="text-caption text-muted-foreground">
            {TRIGGER_LABEL[run.trigger.kind]} · {formatRelativeTime(run.startedAt, Date.now())}
          </div>
        </div>
        <span
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-caption font-bold text-foreground',
            RUN_STATUS_BG_CLASS[run.status],
          )}
        >
          {run.status === 'running' ? (
            <span
              aria-hidden
              className="size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent"
            />
          ) : (
            <span aria-hidden className={cn('size-1.5 rounded-full', RUN_STATUS_DOT_CLASS[run.status])} />
          )}
          {RUN_STATUS_LABEL[run.status]}
        </span>
        {cancellable && (
          <button
            type="button"
            data-testid="automations-run-cancel"
            disabled={cancelling}
            onClick={() => void handleCancel()}
            className="inline-flex h-[28px] items-center gap-1.5 rounded-md border-[0.5px] border-destructive/40 px-2.5 text-caption font-semibold text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square size={10} aria-hidden />
            Cancel
          </button>
        )}
        <button
          type="button"
          data-testid="automations-run-again"
          disabled={starting}
          onClick={() => void handleRunAgain()}
          className="inline-flex h-[28px] items-center gap-1.5 rounded-md border-[0.5px] border-border px-2.5 text-caption font-semibold text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Play size={10} className="text-primary" aria-hidden />
          Run again
        </button>
      </div>

      <div data-testid="automations-run-timeline" className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {topLevel.length === 0 ? (
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Zap size={13} aria-hidden />
            No steps have run yet.
          </div>
        ) : (
          topLevel.map((entry, i) => (
            <RunStepRow
              key={entry.stepRef}
              entry={entry}
              timeline={timeline}
              steps={automation?.definition.steps ?? []}
              catalog={catalog}
              interactions={interactions}
              onOpenChat={openSessionById}
              onInteractionSubmitted={() => void refetchTimeline(run.id)}
              isLast={i === topLevel.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
