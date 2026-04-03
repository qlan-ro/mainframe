import { create } from 'zustand';
import type { Chat, DisplayMessage, ControlRequest, AdapterProcess } from '@qlan-ro/mainframe-types';

export type SessionStatus = 'idle' | 'working' | 'waiting';

export interface ContextUsageState {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
}

interface ChatsState {
  chats: Chat[];
  activeChatId: string | null;
  filterProjectId: string | null;
  messages: Map<string, DisplayMessage[]>;
  pendingPermissions: Map<string, ControlRequest>;
  processes: Map<string, AdapterProcess>;
  compactingChats: Set<string>;
  contextUsage: Map<string, ContextUsageState>;

  setChats: (chats: Chat[]) => void;
  setActiveChat: (id: string | null) => void;
  setFilterProjectId: (id: string | null) => void;
  addChat: (chat: Chat) => void;
  updateChat: (chat: Chat) => void;
  removeChat: (id: string) => void;
  addMessage: (chatId: string, message: DisplayMessage) => void;
  setMessages: (chatId: string, messages: DisplayMessage[]) => void;
  updateMessage: (chatId: string, message: DisplayMessage) => void;
  addPendingPermission: (chatId: string, request: ControlRequest) => void;
  removePendingPermission: (chatId: string) => void;
  setProcess: (chatId: string, process: AdapterProcess) => void;
  updateProcessStatus: (processId: string, status: AdapterProcess['status']) => void;
  removeProcess: (chatId: string) => void;
  setCompacting: (chatId: string, compacting: boolean) => void;
  setContextUsage: (chatId: string, usage: ContextUsageState) => void;
}

export const useChatsStore = create<ChatsState>((set) => ({
  chats: [],
  activeChatId: null,
  filterProjectId: localStorage.getItem('mf:filterProjectId'),
  messages: new Map(),
  pendingPermissions: new Map(),
  processes: new Map(),
  compactingChats: new Set(),
  contextUsage: new Map(),

  setChats: (chats) => set({ chats }),
  setFilterProjectId: (id) => {
    if (id) {
      localStorage.setItem('mf:filterProjectId', id);
    } else {
      localStorage.removeItem('mf:filterProjectId');
    }
    set({ filterProjectId: id });
  },
  setActiveChat: (id) => {
    if (id) {
      localStorage.setItem('mf:activeChatId', id);
    } else {
      localStorage.removeItem('mf:activeChatId');
    }
    set({ activeChatId: id });
  },
  addChat: (chat) =>
    set((state) => {
      const chatTime = new Date(chat.updatedAt ?? chat.createdAt).getTime();
      const idx = state.chats.findIndex((c) => new Date(c.updatedAt ?? c.createdAt).getTime() <= chatTime);
      if (idx === -1) return { chats: [...state.chats, chat] };
      const next = [...state.chats];
      next.splice(idx, 0, chat);
      return { chats: next };
    }),
  updateChat: (chat) =>
    set((state) => {
      const idx = state.chats.findIndex((c) => c.id === chat.id);
      if (idx === -1) return { chats: [chat, ...state.chats] };
      const prev = state.chats[idx]!;
      // Only move to top when updatedAt actually changed (real content update)
      if (chat.updatedAt !== prev.updatedAt) {
        return { chats: [chat, ...state.chats.filter((c) => c.id !== chat.id)] };
      }
      // Otherwise update in-place to preserve list order
      const updated = [...state.chats];
      updated[idx] = chat;
      return { chats: updated };
    }),
  removeChat: (id) =>
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== id),
      activeChatId: state.activeChatId === id ? null : state.activeChatId,
    })),
  addMessage: (chatId, message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const existing = newMessages.get(chatId) || [];
      newMessages.set(chatId, [...existing, message]);
      return { messages: newMessages };
    }),
  setMessages: (chatId, messages) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.set(chatId, messages);
      return { messages: newMessages };
    }),
  updateMessage: (chatId, message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const existing = newMessages.get(chatId) || [];
      const idx = existing.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = message;
        newMessages.set(chatId, updated);
      } else {
        newMessages.set(chatId, [...existing, message]);
      }
      return { messages: newMessages };
    }),
  addPendingPermission: (chatId, request) =>
    set((state) => {
      const newPending = new Map(state.pendingPermissions);
      newPending.set(chatId, request);
      return { pendingPermissions: newPending };
    }),
  removePendingPermission: (chatId) =>
    set((state) => {
      const newPending = new Map(state.pendingPermissions);
      newPending.delete(chatId);
      return { pendingPermissions: newPending };
    }),
  setProcess: (chatId, process) =>
    set((state) => {
      const newProcesses = new Map(state.processes);
      newProcesses.set(chatId, process);
      return { processes: newProcesses };
    }),
  updateProcessStatus: (processId, status) =>
    set((state) => {
      const newProcesses = new Map(state.processes);
      for (const [chatId, proc] of newProcesses) {
        if (proc.id === processId) {
          newProcesses.set(chatId, { ...proc, status });
          break;
        }
      }
      return { processes: newProcesses };
    }),
  removeProcess: (chatId) =>
    set((state) => {
      const newProcesses = new Map(state.processes);
      newProcesses.delete(chatId);
      return { processes: newProcesses };
    }),
  setCompacting: (chatId, compacting) =>
    set((state) => {
      const next = new Set(state.compactingChats);
      if (compacting) {
        next.add(chatId);
      } else {
        next.delete(chatId);
      }
      return { compactingChats: next };
    }),
  setContextUsage: (chatId, usage) =>
    set((state) => {
      const next = new Map(state.contextUsage);
      next.set(chatId, usage);
      return { contextUsage: next };
    }),
}));
