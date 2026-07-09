import { z } from 'zod';

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type BackgroundTaskToolName = 'Bash' | 'Monitor';

/** What a CLI background task is, mapped from the CLI's `task_type` (`local_bash` → `bash`, agents/teammates → `agent`, …). */
export type BackgroundWorkKind = 'bash' | 'agent' | 'workflow' | 'other';

export const BackgroundWorkKindSchema = z.enum(['bash', 'agent', 'workflow', 'other']);

export interface BackgroundTask {
  id: string;
  kind: BackgroundWorkKind;
  toolName: BackgroundTaskToolName;
  toolUseId: string;
  command: string;
  description: string;
  outputPath: string | null;
  startedAt: number;
  endedAt: number | null;
  status: BackgroundTaskStatus;
  lastOutputLine: string | null;
  summary: string | null;
  usage: {
    totalTokens: number;
    toolUses: number;
    durationMs: number;
  } | null;
  /** True when this entry was rehydrated by reconciliation, not produced by a live CLI session. */
  recovered?: true;
}

export interface BackgroundTaskStartedEvent {
  type: 'background_task.started';
  chatId: string;
  task: BackgroundTask;
}

export interface BackgroundTaskUpdatedEvent {
  type: 'background_task.updated';
  chatId: string;
  task: BackgroundTask;
}

export interface BackgroundTaskEndedEvent {
  type: 'background_task.ended';
  chatId: string;
  task: BackgroundTask;
}

export type BackgroundTaskEvent = BackgroundTaskStartedEvent | BackgroundTaskUpdatedEvent | BackgroundTaskEndedEvent;

/** One live background task as surfaced to clients (in `Chat.backgroundActivity` and the UI activity bar). */
export interface BackgroundActivityTask {
  id: string;
  kind: BackgroundWorkKind;
  description: string;
  startedAt: number;
}

/** Live background work for a chat — derived from the tracker, never persisted. */
export interface BackgroundActivity {
  total: number;
  byKind: Partial<Record<BackgroundWorkKind, number>>;
  tasks: BackgroundActivityTask[];
}

export const BackgroundActivityTaskSchema: z.ZodType<BackgroundActivityTask> = z.object({
  id: z.string().min(1),
  kind: BackgroundWorkKindSchema,
  description: z.string(),
  startedAt: z.number(),
});

export const BackgroundActivitySchema: z.ZodType<BackgroundActivity> = z.object({
  total: z.number().int().nonnegative(),
  byKind: z.partialRecord(BackgroundWorkKindSchema, z.number().int().positive()),
  tasks: z.array(BackgroundActivityTaskSchema),
});

/** Project a tracker task onto its client-facing activity entry (bash tasks often carry the command, not a description). */
export function toActivityTask(task: BackgroundTask): BackgroundActivityTask {
  return {
    id: task.id,
    kind: task.kind,
    description: task.description || task.command,
    startedAt: task.startedAt,
  };
}

/** Aggregate live tasks into the `backgroundActivity` payload; undefined when nothing is live. */
export function deriveBackgroundActivity(tasks: BackgroundActivityTask[]): BackgroundActivity | undefined {
  if (tasks.length === 0) return undefined;
  const byKind: Partial<Record<BackgroundWorkKind, number>> = {};
  for (const task of tasks) {
    byKind[task.kind] = (byKind[task.kind] ?? 0) + 1;
  }
  return { total: tasks.length, byKind, tasks };
}
