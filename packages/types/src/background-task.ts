export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type BackgroundTaskToolName = 'Bash' | 'Monitor';

export interface BackgroundTask {
  id: string;
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
