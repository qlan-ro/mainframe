/**
 * activity-kinds — glyphs, labels, tones and row state for the Activity list.
 * Split from `activity-view.ts` to keep that file's running-count/order
 * concerns apart from rendering data (both stay React-free).
 */
import { Bot, CircleDashed, Radar, SquareTerminal, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BackgroundActivityTask, BackgroundTaskStatus } from '@qlan-ro/mainframe-types';
import type { BackgroundStopState } from '@/features/chat/controller/background-activity-state';
import { activityKind, type ActivityKind } from './activity-view';

/** Pairwise distinct (AC16): Monitor gets its own glyph, separate from Agent's. */
export const ACTIVITY_KIND_ICON: Record<ActivityKind, LucideIcon> = {
  agent: Bot,
  bash: SquareTerminal,
  monitor: Radar,
  workflow: Workflow,
  other: CircleDashed,
};

/** Monitor/Task/Agent/Workflow are fixed; `other` shows the CLI's reported type, falling back to Task. */
export function activityLabel(task: BackgroundActivityTask): string {
  switch (activityKind(task)) {
    case 'monitor':
      return 'Monitor';
    case 'bash':
      return 'Task';
    case 'agent':
      return 'Agent';
    case 'workflow':
      return 'Workflow';
    case 'other':
      return task.reportedType ?? 'Task';
  }
}

const STATUS_LABEL: Record<BackgroundTaskStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function statusLabel(status: BackgroundTaskStatus): string {
  return STATUS_LABEL[status];
}

/** success for Completed, destructive for Failed, muted for Stopped/Running. */
export function statusTone(status: BackgroundTaskStatus): string {
  switch (status) {
    case 'completed':
      return 'text-success';
    case 'failed':
      return 'text-destructive';
    case 'stopped':
    case 'running':
      return 'text-muted-foreground';
  }
}

export type ActivityRowState = 'running' | 'stopping' | 'stop-error' | 'completed' | 'failed' | 'stopped';

function isTerminalStatus(status: BackgroundTaskStatus | undefined): status is 'completed' | 'failed' | 'stopped' {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

/** A terminal status always wins over an in-flight stop (a late failure never reverts a settled row). */
export function rowState(task: BackgroundActivityTask, stop: BackgroundStopState | undefined): ActivityRowState {
  if (isTerminalStatus(task.status)) return task.status;
  if (stop?.phase === 'stopping') return 'stopping';
  if (stop?.phase === 'error') return 'stop-error';
  return 'running';
}
