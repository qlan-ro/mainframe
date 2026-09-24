/**
 * activity-view — how much background work is live, and how to say it.
 *
 * `BackgroundActivityTask.status` is optional on the wire (a legacy/mobile
 * payload may omit it), so "running" means "absent or 'running'" everywhere
 * a count is taken — a stopping row is still a running record and still
 * counts (todo #328, AC15). Terminal rows (completed/failed/stopped) never
 * count, no matter how many are retained.
 */
import type { BackgroundActivityTask, BackgroundWorkKind } from '@qlan-ro/mainframe-types';

function isRunningTask(task: BackgroundActivityTask): boolean {
  return task.status === undefined || task.status === 'running';
}

export function runningCount(tasks: readonly BackgroundActivityTask[]): number {
  return tasks.filter(isRunningTask).length;
}

/** Rail tooltip and section summary: "1 task running" / "3 tasks running". */
export function runningLabel(count: number): string {
  if (count === 0) return 'Nothing running';
  return `${count} task${count === 1 ? '' : 's'} running`;
}

/**
 * The kind a row actually renders as — `monitor` is a display-only split of
 * `bash` work started by the Monitor tool, not a `BackgroundWorkKind` the
 * daemon knows about (Monitor tasks carry `kind: 'bash'`; the tool name is
 * the only reliable signal — todo #328 decision).
 */
export type ActivityKind = BackgroundWorkKind | 'monitor';

export function activityKind(task: BackgroundActivityTask): ActivityKind {
  return task.kind === 'bash' && task.toolName === 'Monitor' ? 'monitor' : task.kind;
}

/** Running rows first (start order), then terminal rows (most recently ended first). */
export function orderRows(tasks: readonly BackgroundActivityTask[]): BackgroundActivityTask[] {
  const running = tasks.filter(isRunningTask).sort((a, b) => a.startedAt - b.startedAt);
  const terminal = tasks.filter((task) => !isRunningTask(task)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return [...running, ...terminal];
}
