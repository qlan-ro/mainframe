/**
 * A delegated task's live status: a hue dot plus the muted word. The hue sits
 * on the dot, never the text (design-system rule: semantic hues stay off ink).
 * `primary` = running, `warning` = waits on the user, `success` = completed,
 * `destructive` = failed; queued, cancelled and interrupted stay neutral.
 */
import type { TaskStatus } from '@qlan-ro/mainframe-types';
import { taskStatusLabel } from '@/features/sessions/view-model/agent-provenance';
import { cn } from '@/lib/utils';

const DOT: Record<TaskStatus, string> = {
  queued: 'bg-muted-foreground',
  running: 'bg-primary',
  waiting: 'bg-warning',
  completed: 'bg-success',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground',
  interrupted: 'bg-muted-foreground',
};

interface TaskStatusLabelProps {
  status: TaskStatus;
  /** The child waits on a gate even though its task row still reads running. */
  waiting?: boolean;
  testId?: string;
}

export function TaskStatusLabel({ status, waiting = false, testId }: TaskStatusLabelProps) {
  const shown: TaskStatus = waiting && status === 'running' ? 'waiting' : status;
  return (
    <span
      data-testid={testId}
      data-status={shown}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span aria-hidden className={cn('inline-block size-1.5 rounded-full', DOT[shown])} />
      {taskStatusLabel(shown)}
    </span>
  );
}
