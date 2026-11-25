/**
 * How a delegated task stands, from the three places that say so: the result
 * delivered to its parent, its chat's row in the session list, and what its own
 * call returned. Pure. A delivered result is the last word; the list can lag
 * behind it or not hold the chat at all.
 */
import { isTerminalTaskStatus, type TaskStatus } from '@qlan-ro/mainframe-types';

export interface TaskSources {
  readonly delivered?: TaskStatus;
  readonly listed?: TaskStatus;
  /** From the call's own return: final only for a call that waited. */
  readonly launched?: TaskStatus;
}

export function taskStatusOf({ delivered, listed, launched }: TaskSources): TaskStatus | undefined {
  if (delivered) return delivered;
  if (listed && isTerminalTaskStatus(listed)) return listed;
  if (launched && isTerminalTaskStatus(launched)) return launched;
  return listed;
}

/**
 * A finished task's chat can be resumed, and is going again while it runs. A
 * failed or stopped one is not: its chat only winds down.
 */
export function resumed(status: TaskStatus, chatRunning: boolean): boolean {
  return chatRunning && (status === 'completed' || status === 'interrupted');
}
