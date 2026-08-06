/**
 * activity-view — how much background work is live, and how to say it.
 *
 * `BackgroundActivityTask` carries no status field: the daemon filters the list
 * to running work before it ships, so the count is the length. The seam exists
 * so the rail badge, the section badge, and the tooltip all read the same rule.
 */
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';

export function runningCount(tasks: readonly BackgroundActivityTask[]): number {
  return tasks.length;
}

/** Rail tooltip and section summary: "1 task running" / "3 tasks running". */
export function runningLabel(count: number): string {
  if (count === 0) return 'Nothing running';
  return `${count} task${count === 1 ? '' : 's'} running`;
}
