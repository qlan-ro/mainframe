/**
 * ActivityDetail — the Activity list's drill-in for a non-workflow row (or a
 * workflow row whose run is not yet known): everything the daemon already
 * knows about the task, plus the on-demand output tail. Reuses the workflow
 * row's level-swap idiom (back button labelled "Activity") rather than a
 * second "more than a row" pattern (todo #328 design direction, verdict B).
 */
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import type { BackgroundStopState } from '@/features/chat/controller/background-activity-state';
import { cn } from '@/lib/utils';
import { formatRunDuration, formatRunTokens } from '@/features/chat/workflow/workflow-progress';
import { ACTIVITY_KIND_ICON, activityLabel, rowState, statusLabel, statusTone } from './activity-kinds';
import { activityKind } from './activity-view';
import { formatElapsed } from './background-activity-view';
import { ActivityOutputTail } from './ActivityOutputTail';
import { useOutputTail } from './use-output-tail';

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-xs break-words whitespace-pre-wrap">{children}</div>
    </div>
  );
}

export interface ActivityDetailProps {
  task: BackgroundActivityTask;
  now: number;
  stop: BackgroundStopState | undefined;
  chatId: string | undefined;
  onBack: () => void;
}

export function ActivityDetail({ task, now, stop, chatId, onBack }: ActivityDetailProps) {
  const kind = activityKind(task);
  const Icon = ACTIVITY_KIND_ICON[kind];
  const state = rowState(task, stop);
  const isTerminal = state === 'completed' || state === 'failed' || state === 'stopped';
  const duration =
    isTerminal && task.endedAt !== undefined
      ? formatRunDuration(task.endedAt - task.startedAt)
      : formatElapsed(task.startedAt, now);
  const { state: tail, refresh } = useOutputTail(chatId, task);

  return (
    <>
      <button
        type="button"
        data-testid={`activity-drill-back-${task.id}`}
        onClick={onBack}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3" aria-hidden />
        Activity
      </button>
      <div data-testid={`activity-detail-${task.id}`} className="flex flex-col gap-3 px-1 py-1.5">
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">{activityLabel(task)}</span>
          {isTerminal && (
            <span className={cn('text-xs', statusTone(task.status ?? 'running'))}>
              {statusLabel(task.status ?? 'running')}
            </span>
          )}
          {state === 'stopping' && <span className="text-xs text-muted-foreground">Stopping…</span>}
        </div>

        <DetailField label="Description">{task.description || 'Background task'}</DetailField>
        {task.command && (
          <DetailField label="Command">
            <code className="font-mono">{task.command}</code>
          </DetailField>
        )}
        {task.kind === 'bash' && task.toolName && <DetailField label="Tool">{task.toolName}</DetailField>}
        <DetailField label="Started">{new Date(task.startedAt).toLocaleString()}</DetailField>
        <DetailField label={isTerminal ? 'Duration' : 'Elapsed'}>{duration}</DetailField>
        {task.recovered && (
          <DetailField label="Recovered">Rehydrated after a daemon restart — no live process was found.</DetailField>
        )}
        {kind === 'other' && task.reportedType && <DetailField label="Reported type">{task.reportedType}</DetailField>}
        {task.summary && <DetailField label="Summary">{task.summary}</DetailField>}
        {task.lastOutputLine && (
          <DetailField label="Last output line">
            <code className="font-mono">{task.lastOutputLine}</code>
          </DetailField>
        )}
        {task.usage && (
          <DetailField label="Usage">
            {`${formatRunTokens(task.usage.totalTokens)} · ${task.usage.toolUses} tool use${task.usage.toolUses === 1 ? '' : 's'} · ${formatRunDuration(task.usage.durationMs)}`}
          </DetailField>
        )}
        {state === 'stop-error' && stop?.phase === 'error' && (
          <DetailField label="Stop failed">
            <span className="text-destructive">{stop.message}</span>
          </DetailField>
        )}

        <ActivityOutputTail taskId={task.id} tail={tail} onRefresh={refresh} />
      </div>
    </>
  );
}
