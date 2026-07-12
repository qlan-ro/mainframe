/**
 * LastRunPill — status dot + relative time for an automation's most recent
 * run; clicking it opens that run in the run view. `null`/`undefined` renders
 * "Never run" (inert). Ink policy: the semantic status hue lives on the dot
 * only — the label and time stay on `foreground`/`muted-foreground`, never
 * colored text (typography audit §1).
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { AutomationRunStatus, AutomationRunSummary } from '../contract';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';

/** Exported so RunView's header status pill uses the exact same run-status vocabulary — one source of truth. */
export const RUN_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const RUN_STATUS_DOT_CLASS: Record<AutomationRunStatus, string> = {
  running: 'bg-primary',
  waiting: 'bg-mf-warning',
  succeeded: 'bg-mf-success',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground',
};

interface LastRunPillProps {
  automationId: string;
  run?: AutomationRunSummary;
  onOpen: (runId: string) => void;
}

export function LastRunPill({ automationId, run, onOpen }: LastRunPillProps): React.ReactElement {
  const testId = `automations-library-last-run-${automationId}`;

  if (!run) {
    return (
      <span data-testid={testId} className="text-caption text-muted-foreground">
        Never run
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onOpen(run.id)}
      className="inline-flex items-center gap-[5px] rounded text-caption hover:underline"
    >
      {run.status === 'running' ? (
        <span
          aria-hidden
          className="size-[8px] shrink-0 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent"
        />
      ) : (
        <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', RUN_STATUS_DOT_CLASS[run.status])} />
      )}
      <span className="font-medium text-foreground">{RUN_STATUS_LABEL[run.status]}</span>
      <span className="text-muted-foreground">· {formatRelativeTime(run.startedAt, Date.now())}</span>
    </button>
  );
}
