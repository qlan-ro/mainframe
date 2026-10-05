/**
 * RunTrace — a run's step timeline: fetched on demand via
 * `gateway.getRunTimeline` and kept as local state, refetched on every
 * `runRevisions` bump (ts153 wf2-runtime.jsx `WfRunView`'s body, ported off
 * the old full-page `RunView` now that `details/RunsColumn` replaced its
 * header/back-button shell, 2026-10 redesign). Self-sufficient like
 * `AutomationEditor`: resolves `run`/`automation`/`interactions`/`catalog`/
 * `gateway` off the `runId` prop rather than taking them.
 *
 * Only TOP-LEVEL entries (no `#` in `stepRef`) map to a row here — Repeat
 * fan-out entries are nested by `RunStepRow`/`RunRepeatGroup` themselves.
 */
import { useCallback, useEffect, useState } from 'react';
import { Play, Square, Zap } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { openSessionById } from '@/lib/session-nav';
import type { AutomationRunSummary, AutomationTimelineEntry } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { selectAutomationById, selectRunById, useAutomationsStore } from '../data/use-automations-store';
import { RunStepRow } from './RunStepRow';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function isTopLevel(entry: AutomationTimelineEntry): boolean {
  return !entry.stepRef.includes('#');
}

export interface RunTraceProps {
  runId: string;
  /** Starts every top-level step expanded — see `RunStepRow`'s `defaultOpen`. */
  forceOpenDefault?: boolean;
}

export function RunTrace({ runId, forceOpenDefault = false }: RunTraceProps) {
  const selectRun = useAutomationsNav((s) => s.selectRun);
  const interactions = useAutomationsStore((s) => s.interactions);
  const catalog = useAutomationsStore((s) => s.catalog);
  const gateway = useAutomationsStore((s) => s.gateway);
  const patchRun = useAutomationsStore((s) => s.patchRun);
  const runRev = useAutomationsStore((s) => s.runRevisions[runId] ?? 0);

  const run = useAutomationsStore(selectRunById(runId));
  const automation = useAutomationsStore(selectAutomationById(run?.automationId ?? null));

  const [timeline, setTimeline] = useState<AutomationTimelineEntry[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);

  const refetchTimeline = useCallback(async () => {
    try {
      setTimeline(await gateway.getRunTimeline(runId));
    } catch (err) {
      mfToast.error('Could not load the run timeline', { description: errorMessage(err) });
    }
  }, [gateway, runId]);

  // Keyed on runId and runRev, a per-run counter `patchRun` bumps on every
  // applied update — the daemon emits `automation.run.updated` per step
  // transition, not just on a run-level status change, so status alone
  // under-refetches.
  useEffect(() => {
    void refetchTimeline();
  }, [runId, runRev]);

  async function handleRunAgain(): Promise<void> {
    if (!run || starting) return;
    setStarting(true);
    try {
      const next: AutomationRunSummary = await gateway.startRun(run.automationId);
      patchRun(next);
      selectRun(next.id);
    } catch (err) {
      mfToast.error('Could not start the run', { description: errorMessage(err) });
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel(): Promise<void> {
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
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        This run couldn't be found.
      </div>
    );
  }

  const cancellable = run.status === 'running' || run.status === 'waiting';
  const topLevel = timeline.filter(isTopLevel);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-[8px] border-b border-border px-[16px] py-[10px]">
        {cancellable && (
          <button
            type="button"
            data-testid="automations-run-cancel"
            disabled={cancelling}
            onClick={() => void handleCancel()}
            className="inline-flex h-[26px] items-center gap-[5px] rounded-md border-[0.5px] border-destructive/40 px-[10px] text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square size={12} fill="currentColor" aria-hidden />
            Cancel
          </button>
        )}
        <button
          type="button"
          data-testid="automations-run-again"
          disabled={starting}
          onClick={() => void handleRunAgain()}
          className="inline-flex h-[26px] items-center gap-[5px] rounded-md border-[0.5px] border-border px-[10px] text-xs font-semibold text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Play size={12} className="text-primary" fill="currentColor" aria-hidden />
          Run again
        </button>
      </div>

      <div
        data-testid="automations-run-timeline"
        className="min-h-0 flex-1 overflow-y-auto px-[16px] pt-[14px] pb-[22px]"
      >
        {topLevel.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap size={14} aria-hidden />
            No steps have run yet.
          </div>
        ) : (
          topLevel.map((entry, i) => (
            <RunStepRow
              // Keyed by runId too, not just stepRef: switching the column's
              // selected run must remount every row fresh so its default-open
              // state (`forceOpenDefault`) is recomputed rather than carried
              // over from whichever run happened to render that stepRef first.
              key={`${runId}-${entry.stepRef}`}
              entry={entry}
              timeline={timeline}
              steps={automation?.definition.steps ?? []}
              catalog={catalog}
              interactions={interactions}
              onOpenChat={openSessionById}
              onInteractionSubmitted={() => void refetchTimeline()}
              isLast={i === topLevel.length - 1}
              defaultOpen={forceOpenDefault || undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
