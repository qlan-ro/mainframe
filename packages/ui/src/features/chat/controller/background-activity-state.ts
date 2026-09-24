/**
 * Pure reducer for the background-activity slice: running + terminal task rows,
 * keyed by id, plus the stop-in-flight state for rows the user is stopping.
 * Split out of `chat-environment-state.ts` (which delegates its `background.*`
 * cases here) to keep both files under 300 lines.
 *
 * Terminal retention (AC14, todo #328): a finishing task keeps its row instead
 * of vanishing, capped at `TERMINAL_ROW_CAP` most-recent terminal rows (oldest
 * `endedAt` dropped first), cleared by an explicit dismissal or the next user
 * turn. The running count stays derived from `status`, never from slice size.
 */
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { sameBackgroundTasks } from './snapshot-equality';

/** Most-recent terminal rows kept before the oldest (by `endedAt`) is dropped. */
export const TERMINAL_ROW_CAP = 5;

export type BackgroundStopState = { phase: 'stopping' } | { phase: 'error'; message: string };

export interface BackgroundActivitySlice {
  /**
   * Background work (agents / bg bash / workflows) keyed by task id — running
   * rows fed by `background_task.*` events and resynced from `chat.updated`'s
   * `backgroundActivity` snapshot; terminal rows (completed/failed/stopped)
   * stay listed until dismissed, the next turn starts, or the retention cap
   * evicts the oldest. Drives the session panel's Activity section and its
   * rail badge (which counts only `running` rows — see `runningCount`).
   */
  readonly backgroundTasks: Readonly<Record<string, BackgroundActivityTask>>;
  /** In-flight/failed stop requests, keyed by task id — cleared when the task ends. */
  readonly backgroundStops: Readonly<Record<string, BackgroundStopState>>;
}

export type BackgroundActivityEvent =
  | { type: 'background.upsert'; task: BackgroundActivityTask }
  | { type: 'background.ended'; task: BackgroundActivityTask }
  | { type: 'background.snapshot'; tasks: BackgroundActivityTask[] }
  | { type: 'background.dismissed'; taskId: string }
  | { type: 'background.turn.started' }
  | { type: 'background.stop.requested'; taskId: string }
  | { type: 'background.stop.failed'; taskId: string; message: string }
  | { type: 'background.removed'; taskId: string };

export function createBackgroundActivitySlice(): BackgroundActivitySlice {
  return {
    backgroundTasks: {} as Readonly<Record<string, BackgroundActivityTask>>,
    backgroundStops: {} as Readonly<Record<string, BackgroundStopState>>,
  };
}

function isTerminal(task: BackgroundActivityTask): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'stopped';
}

/** Drops the oldest (smallest `endedAt`) terminal rows past `TERMINAL_ROW_CAP`. */
function capTerminalRows(tasks: Record<string, BackgroundActivityTask>): Record<string, BackgroundActivityTask> {
  const terminalIds = Object.values(tasks)
    .filter(isTerminal)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    .map((t) => t.id);
  const excess = terminalIds.length - TERMINAL_ROW_CAP;
  if (excess <= 0) return tasks;
  const next = { ...tasks };
  for (const id of terminalIds.slice(0, excess)) delete next[id];
  return next;
}

/** Keeps only the stop-state entries whose task id is still present in `tasks`. */
function pruneStops(
  stops: Readonly<Record<string, BackgroundStopState>>,
  tasks: Readonly<Record<string, BackgroundActivityTask>>,
): Record<string, BackgroundStopState> {
  const next: Record<string, BackgroundStopState> = {};
  for (const [id, stop] of Object.entries(stops)) {
    if (id in tasks) next[id] = stop;
  }
  return next;
}

export function reduceBackgroundActivityEvent(
  slice: BackgroundActivitySlice,
  event: BackgroundActivityEvent,
): BackgroundActivitySlice {
  switch (event.type) {
    case 'background.upsert':
      return { ...slice, backgroundTasks: { ...slice.backgroundTasks, [event.task.id]: event.task } };

    case 'background.ended': {
      // Never listed (AC14) — a task the client never saw start settles silently.
      if (!(event.task.id in slice.backgroundTasks)) return slice;
      const backgroundTasks = capTerminalRows({ ...slice.backgroundTasks, [event.task.id]: event.task });
      // Drop this task's own stop state (it just settled) as well as any for a
      // row the cap evicted.
      const backgroundStops = pruneStops(slice.backgroundStops, backgroundTasks);
      delete backgroundStops[event.task.id];
      return { backgroundTasks, backgroundStops };
    }

    case 'background.snapshot': {
      const backgroundTasks: Record<string, BackgroundActivityTask> = {};
      // Every terminal entry already held survives a snapshot — the snapshot
      // only ever lists running work.
      for (const [id, task] of Object.entries(slice.backgroundTasks)) {
        if (isTerminal(task)) backgroundTasks[id] = task;
      }
      // Snapshot entries add/refresh running rows, but never override an
      // already-terminal local row (a race between `ended` and the next
      // `chat.updated` must not resurrect a row as running).
      for (const task of event.tasks) {
        const current = backgroundTasks[task.id];
        if (current !== undefined && isTerminal(current)) continue;
        backgroundTasks[task.id] = task;
      }
      if (sameBackgroundTasks(slice.backgroundTasks, Object.values(backgroundTasks))) return slice;
      const backgroundStops = pruneStops(slice.backgroundStops, backgroundTasks);
      return { backgroundTasks, backgroundStops };
    }

    case 'background.dismissed': {
      const task = slice.backgroundTasks[event.taskId];
      if (task === undefined || !isTerminal(task)) return slice;
      const backgroundTasks = { ...slice.backgroundTasks };
      delete backgroundTasks[event.taskId];
      const backgroundStops = pruneStops(slice.backgroundStops, backgroundTasks);
      return { backgroundTasks, backgroundStops };
    }

    case 'background.turn.started': {
      const backgroundTasks: Record<string, BackgroundActivityTask> = {};
      let changed = false;
      for (const [id, task] of Object.entries(slice.backgroundTasks)) {
        if (isTerminal(task)) {
          changed = true;
          continue;
        }
        backgroundTasks[id] = task;
      }
      if (!changed) return slice;
      const backgroundStops = pruneStops(slice.backgroundStops, backgroundTasks);
      return { backgroundTasks, backgroundStops };
    }

    case 'background.stop.requested': {
      const task = slice.backgroundTasks[event.taskId];
      if (task === undefined || isTerminal(task)) return slice;
      return { ...slice, backgroundStops: { ...slice.backgroundStops, [event.taskId]: { phase: 'stopping' } } };
    }

    case 'background.stop.failed': {
      const task = slice.backgroundTasks[event.taskId];
      if (task === undefined || isTerminal(task)) return slice;
      return {
        ...slice,
        backgroundStops: { ...slice.backgroundStops, [event.taskId]: { phase: 'error', message: event.message } },
      };
    }

    case 'background.removed': {
      if (!(event.taskId in slice.backgroundTasks) && !(event.taskId in slice.backgroundStops)) return slice;
      const backgroundTasks = { ...slice.backgroundTasks };
      delete backgroundTasks[event.taskId];
      const backgroundStops = { ...slice.backgroundStops };
      delete backgroundStops[event.taskId];
      return { backgroundTasks, backgroundStops };
    }
  }
}
