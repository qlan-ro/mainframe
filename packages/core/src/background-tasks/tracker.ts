import { EventEmitter } from 'node:events';
import type { BackgroundTask, BackgroundTaskStatus } from '@qlan-ro/mainframe-types';

type TerminalUpdate = {
  status: Exclude<BackgroundTaskStatus, 'running'>;
  outputPath: string;
  summary: string;
  usage: BackgroundTask['usage'];
};

const TERMINAL = new Set<BackgroundTaskStatus>(['completed', 'failed', 'stopped']);

interface AdoptOptions {
  emit?: boolean;
}

export class BackgroundTaskTracker {
  private readonly emitter = new EventEmitter();
  private readonly byChat = new Map<string, Map<string, BackgroundTask>>();
  /** Tracker-private: chatId → taskId → pid. Advisory only — every kill re-runs lsofWriters. */
  private readonly pidByChat = new Map<string, Map<string, number>>();

  start(
    chatId: string,
    seed: Pick<BackgroundTask, 'id' | 'toolName' | 'toolUseId' | 'command' | 'description'>,
    outputPath: string,
  ): BackgroundTask {
    const task: BackgroundTask = {
      ...seed,
      outputPath,
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
      // Prefer the outputPath we already have (set at start) over the late notification.
      outputPath: update.outputPath === '' || update.outputPath == null ? existing.outputPath : update.outputPath,
      summary: update.summary,
      usage: update.usage,
      endedAt: Date.now(),
    };
    chat!.set(taskId, next);
    this.emitter.emit('background_task.ended', chatId, next);
    return next;
  }

  /**
   * Insert a fully-formed task from reconciliation. Replaces any existing entry
   * with the same id.
   */
  adopt(chatId: string, task: BackgroundTask, options: AdoptOptions = {}): void {
    const chat = this.byChat.get(chatId) ?? new Map<string, BackgroundTask>();
    chat.set(task.id, task);
    this.byChat.set(chatId, chat);
    if (options.emit === true) {
      const event = task.status === 'running' ? 'background_task.started' : 'background_task.ended';
      this.emitter.emit(event, chatId, task);
    }
  }

  get(chatId: string, taskId: string): BackgroundTask | null {
    return this.byChat.get(chatId)?.get(taskId) ?? null;
  }

  list(chatId: string): BackgroundTask[] {
    const chat = this.byChat.get(chatId);
    return chat ? [...chat.values()] : [];
  }

  /**
   * Cross-chat iterator over running tasks. Returns readonly references so
   * sweep callers (liveness, kill) can't mutate tracker state in place.
   */
  listAllRunning(): Array<{ chatId: string; task: Readonly<BackgroundTask> }> {
    const out: Array<{ chatId: string; task: Readonly<BackgroundTask> }> = [];
    for (const [chatId, chat] of this.byChat) {
      for (const task of chat.values()) {
        if (task.status === 'running') out.push({ chatId, task });
      }
    }
    return out;
  }

  removeChat(chatId: string): void {
    this.byChat.delete(chatId);
    this.pidByChat.delete(chatId);
  }

  setPid(chatId: string, taskId: string, pid: number): void {
    const m = this.pidByChat.get(chatId) ?? new Map<string, number>();
    m.set(taskId, pid);
    this.pidByChat.set(chatId, m);
  }

  getPid(chatId: string, taskId: string): number | null {
    return this.pidByChat.get(chatId)?.get(taskId) ?? null;
  }

  on(
    event: 'background_task.started' | 'background_task.ended',
    listener: (chatId: string, task: BackgroundTask) => void,
  ): void {
    this.emitter.on(event, listener);
  }
}
