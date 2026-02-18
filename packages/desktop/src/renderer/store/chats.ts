import { create } from 'zustand';
import type { Chat, ChatMessage, PermissionRequest, AdapterProcess } from '@mainframe/types';

export type SessionStatus = 'idle' | 'working' | 'waiting';

interface ChatsState {
  chats: Chat[];
  activeChatId: string | null;
  messages: Map<string, ChatMessage[]>;
  pendingPermissions: Map<string, PermissionRequest>;
  processes: Map<string, AdapterProcess>;

  setChats: (chats: Chat[]) => void;
  setActiveChat: (id: string | null) => void;
  addChat: (chat: Chat) => void;
  updateChat: (chat: Chat) => void;
  removeChat: (id: string) => void;
  addMessage: (chatId: string, message: ChatMessage) => void;
  setMessages: (chatId: string, messages: ChatMessage[]) => void;
  addPendingPermission: (chatId: string, request: PermissionRequest) => void;
  removePendingPermission: (chatId: string) => void;
  setProcess: (chatId: string, process: AdapterProcess) => void;
  updateProcessStatus: (processId: string, status: AdapterProcess['status']) => void;
  removeProcess: (chatId: string) => void;
}

export const useChatsStore = create<ChatsState>((set) => ({
  chats: [],
  activeChatId: null,
  messages: new Map(),
  pendingPermissions: new Map(),
  processes: new Map(),

  setChats: (chats) => set({ chats }),
  setActiveChat: (id) => set({ activeChatId: id }),
  addChat: (chat) => set((state) => ({ chats: [chat, ...state.chats] })),
  updateChat: (chat) =>
    set((state) => ({
      chats: [chat, ...state.chats.filter((c) => c.id !== chat.id)],
    })),
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
}));
