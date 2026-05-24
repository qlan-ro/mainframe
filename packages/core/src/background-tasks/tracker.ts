import { EventEmitter } from 'node:events';
import type { BackgroundTask, BackgroundTaskStatus } from '@qlan-ro/mainframe-types';

type TerminalUpdate = {
  status: Exclude<BackgroundTaskStatus, 'running'>;
  outputPath: string;
  summary: string;
  usage: BackgroundTask['usage'];
};

const TERMINAL = new Set<BackgroundTaskStatus>(['completed', 'failed', 'stopped']);

export class BackgroundTaskTracker {
  private readonly emitter = new EventEmitter();
  private readonly byChat = new Map<string, Map<string, BackgroundTask>>();

  start(
    chatId: string,
    seed: Pick<BackgroundTask, 'id' | 'toolName' | 'toolUseId' | 'command' | 'description'>,
  ): BackgroundTask {
    const task: BackgroundTask = {
      ...seed,
      outputPath: null,
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      lastOutputLine: null,
      summary: null,
      usage: null,
    };
    const chat = this.byChat.get(chatId) ?? new Map<string, BackgroundTask>();
    chat.set(task.id, task);
    this.byChat.set(chatId, chat);
    this.emitter.emit('background_task.started', chatId, task);
    return task;
  }

  end(chatId: string, taskId: string, update: TerminalUpdate): BackgroundTask | null {
    const chat = this.byChat.get(chatId);
    const existing = chat?.get(taskId);
    if (!existing) return null; // end without start — drop
    if (TERMINAL.has(existing.status)) return existing; // dedup terminal status
    const next: BackgroundTask = {
      ...existing,
      status: update.status,
      outputPath: update.outputPath === '' ? null : update.outputPath,
      summary: update.summary,
      usage: update.usage,
      endedAt: Date.now(),
    };
    chat!.set(taskId, next);
    this.emitter.emit('background_task.ended', chatId, next);
    return next;
  }

  get(chatId: string, taskId: string): BackgroundTask | null {
    return this.byChat.get(chatId)?.get(taskId) ?? null;
  }

  list(chatId: string): BackgroundTask[] {
    const chat = this.byChat.get(chatId);
    if (!chat) return [];
    return [...chat.values()];
  }

  removeChat(chatId: string): void {
    this.byChat.delete(chatId);
  }

  on(
    event: 'background_task.started' | 'background_task.ended',
    listener: (chatId: string, task: BackgroundTask) => void,
  ): void {
    this.emitter.on(event, listener);
  }
}
