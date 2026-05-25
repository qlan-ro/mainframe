import { create } from 'zustand';
import type { BackgroundTask, BackgroundTaskEvent } from '@qlan-ro/mainframe-types';

interface BackgroundTasksState {
  byChat: Map<string, BackgroundTask[]>;
  hydrate: (chatId: string, tasks: BackgroundTask[]) => void;
  applyEvent: (event: BackgroundTaskEvent) => void;
  listByChat: (chatId: string) => BackgroundTask[];
  runningCount: (chatId: string) => number;
}

function replaceOrInsert(list: BackgroundTask[], task: BackgroundTask): BackgroundTask[] {
  const i = list.findIndex((t) => t.id === task.id);
  if (i === -1) return [...list, task];
  const copy = list.slice();
  copy[i] = task;
  return copy;
}

export const useBackgroundTasksStore = create<BackgroundTasksState>((set, get) => ({
  byChat: new Map(),

  hydrate: (chatId, tasks) => {
    set((s) => {
      const next = new Map(s.byChat);
      next.set(chatId, tasks);
      return { byChat: next };
    });
  },

  applyEvent: (event) => {
    set((s) => {
      const next = new Map(s.byChat);
      const current = next.get(event.chatId) ?? [];
      next.set(event.chatId, replaceOrInsert(current, event.task));
      return { byChat: next };
    });
  },

  listByChat: (chatId) => get().byChat.get(chatId) ?? [],

  runningCount: (chatId) => (get().byChat.get(chatId) ?? []).filter((t) => t.status === 'running').length,
}));
