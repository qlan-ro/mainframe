import { z } from 'zod';

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type BackgroundTaskToolName = 'Bash' | 'Monitor';

/** What a CLI background task is, mapped from the CLI's `task_type` (`local_bash` → `bash`, agents/teammates → `agent`, …). */
export type BackgroundWorkKind = 'bash' | 'agent' | 'workflow' | 'other';

export const BackgroundWorkKindSchema = z.enum(['bash', 'agent', 'workflow', 'other']);

export const BackgroundTaskStatusSchema = z.enum(['running', 'completed', 'failed', 'stopped']);

export const BackgroundTaskToolNameSchema = z.enum(['Bash', 'Monitor']);

export const BackgroundTaskUsageSchema = z.object({
  totalTokens: z.number(),
  toolUses: z.number(),
  durationMs: z.number(),
});

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
  workflowName?: string;
  runId?: string;
  /** The CLI's raw `task_type`, kept alongside the mapped `kind` so an unmapped upstream type stays visible. */
  reportedType?: string;
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

/**
 * One background task as surfaced to clients (in `Chat.backgroundActivity` and the UI
 * activity bar). `status`/`toolName`/`command` are always set by `toActivityTask` but
 * stay optional here so the schema still parses a legacy four-field (mobile) payload.
 * The rest are set only when the source task carries a non-null value.
 */
export interface BackgroundActivityTask {
  id: string;
  kind: BackgroundWorkKind;
  description: string;
  startedAt: number;
  status?: BackgroundTaskStatus;
  toolName?: BackgroundTaskToolName;
  command?: string;
  outputPath?: string;
  endedAt?: number;
  lastOutputLine?: string;
  summary?: string;
  usage?: {
    totalTokens: number;
    toolUses: number;
    durationMs: number;
  };
  /** True when this entry was rehydrated by reconciliation, not produced by a live CLI session. */
  recovered?: boolean;
  /** The CLI's raw `task_type`, set only for tasks the mapper doesn't recognise. */
  reportedType?: string;
  workflowName?: string;
  runId?: string;
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
  status: BackgroundTaskStatusSchema.optional(),
  toolName: BackgroundTaskToolNameSchema.optional(),
  command: z.string().optional(),
  outputPath: z.string().optional(),
  endedAt: z.number().optional(),
  lastOutputLine: z.string().optional(),
  summary: z.string().optional(),
  usage: BackgroundTaskUsageSchema.optional(),
  recovered: z.boolean().optional(),
  reportedType: z.string().optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
});

export const BackgroundActivitySchema: z.ZodType<BackgroundActivity> = z.object({
  total: z.number().int().nonnegative(),
  byKind: z.partialRecord(BackgroundWorkKindSchema, z.number().int().positive()),
  tasks: z.array(BackgroundActivityTaskSchema),
});

/**
 * Project a tracker task onto its client-facing activity entry (bash tasks often carry
 * the command, not a description). `status`/`toolName`/`command` are always set; the
 * rest are set only when the source task carries a non-null value, so a minimal
 * (running, freshly-started) task projects to exactly its required keys.
 */
export function toActivityTask(task: BackgroundTask): BackgroundActivityTask {
  return {
    id: task.id,
    kind: task.kind,
    description: task.description || task.command,
    startedAt: task.startedAt,
    status: task.status,
    toolName: task.toolName,
    command: task.command,
    ...(task.outputPath !== null ? { outputPath: task.outputPath } : {}),
    ...(task.endedAt !== null ? { endedAt: task.endedAt } : {}),
    ...(task.lastOutputLine !== null ? { lastOutputLine: task.lastOutputLine } : {}),
    ...(task.summary !== null ? { summary: task.summary } : {}),
    ...(task.usage !== null ? { usage: task.usage } : {}),
    ...(task.recovered ? { recovered: true } : {}),
    ...(task.reportedType !== undefined ? { reportedType: task.reportedType } : {}),
    ...(task.workflowName !== undefined ? { workflowName: task.workflowName } : {}),
    ...(task.runId !== undefined ? { runId: task.runId } : {}),
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
