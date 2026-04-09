import { create } from 'zustand';
import type {
  Chat,
  DisplayMessage,
  ControlRequest,
  AdapterProcess,
  QueuedMessageRef,
  TodoItem,
  DetectedPr,
} from '@qlan-ro/mainframe-types';

export type { DetectedPr } from '@qlan-ro/mainframe-types';

export type SessionStatus = 'idle' | 'working' | 'waiting';

const MAX_MESSAGES_PER_CHAT = 2000;
const MAX_DISPLAY_CHATS = 50;

function capMessages(msgs: DisplayMessage[]): DisplayMessage[] {
  return msgs.length > MAX_MESSAGES_PER_CHAT ? msgs.slice(-MAX_MESSAGES_PER_CHAT) : msgs;
}

function evictMessages(
  messages: Map<string, DisplayMessage[]>,
  currentChatId: string | null,
): Map<string, DisplayMessage[]> {
  if (messages.size <= MAX_DISPLAY_CHATS) return messages;
  const evicted = new Map(messages);
  for (const key of evicted.keys()) {
    if (evicted.size <= MAX_DISPLAY_CHATS) break;
    if (key === currentChatId) continue;
    evicted.delete(key);
  }
  return evicted;
}

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
  queuedMessages: Map<string, QueuedMessageRef[]>;
  compactingChats: Set<string>;
  contextUsage: Map<string, ContextUsageState>;
  unreadChatIds: Set<string>;
  todos: Map<string, TodoItem[]>;
  detectedPrs: Map<string, DetectedPr[]>;

  markUnread: (chatId: string) => void;
  clearUnread: (chatId: string) => void;
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
  addQueuedMessage: (chatId: string, ref: QueuedMessageRef) => void;
  removeQueuedMessage: (chatId: string, uuid: string) => void;
  clearQueuedMessages: (chatId: string) => void;
  setCompacting: (chatId: string, compacting: boolean) => void;
  setContextUsage: (chatId: string, usage: ContextUsageState) => void;
  setTodos: (chatId: string, todos: TodoItem[]) => void;
  addDetectedPr: (chatId: string, pr: DetectedPr) => void;
}

export const useChatsStore = create<ChatsState>((set) => ({
  chats: [],
  activeChatId: null,
  filterProjectId: localStorage.getItem('mf:filterProjectId'),
  messages: new Map(),
  pendingPermissions: new Map(),
  processes: new Map(),
  queuedMessages: new Map(),
  compactingChats: new Set(),
  contextUsage: new Map(),
  unreadChatIds: new Set(),
  todos: new Map(),
  detectedPrs: new Map(),

  markUnread: (chatId) =>
    set((state) => {
      const next = new Set(state.unreadChatIds);
      next.add(chatId);
      return { unreadChatIds: next };
    }),
  clearUnread: (chatId) =>
    set((state) => {
      if (!state.unreadChatIds.has(chatId)) return state;
      const next = new Set(state.unreadChatIds);
      next.delete(chatId);
      return { unreadChatIds: next };
    }),
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
    set((state) => {
      const unreadChatIds =
        id && state.unreadChatIds.has(id)
          ? (() => {
              const s = new Set(state.unreadChatIds);
              s.delete(id);
              return s;
            })()
          : state.unreadChatIds;
      return { activeChatId: id, unreadChatIds };
    });
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
    set((state) => {
      const messages = new Map(state.messages);
      messages.delete(id);
      const pendingPermissions = new Map(state.pendingPermissions);
      pendingPermissions.delete(id);
      const processes = new Map(state.processes);
      processes.delete(id);
      const queuedMessages = new Map(state.queuedMessages);
      queuedMessages.delete(id);
      const contextUsage = new Map(state.contextUsage);
      contextUsage.delete(id);
      const compactingChats = new Set(state.compactingChats);
      compactingChats.delete(id);
      const todos = new Map(state.todos);
      todos.delete(id);
      const detectedPrs = new Map(state.detectedPrs);
      detectedPrs.delete(id);
      return {
        chats: state.chats.filter((c) => c.id !== id),
        activeChatId: state.activeChatId === id ? null : state.activeChatId,
        messages,
        pendingPermissions,
        processes,
        queuedMessages,
        contextUsage,
        compactingChats,
        todos,
        detectedPrs,
      };
    }),
  addMessage: (chatId, message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const existing = newMessages.get(chatId) || [];
      newMessages.set(chatId, capMessages([...existing, message]));
      return { messages: evictMessages(newMessages, state.activeChatId) };
    }),
  setMessages: (chatId, messages) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.set(chatId, capMessages(messages));
      return { messages: evictMessages(newMessages, state.activeChatId) };
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
        newMessages.set(chatId, capMessages([...existing, message]));
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
  addQueuedMessage: (chatId, ref) =>
    set((state) => {
      const next = new Map(state.queuedMessages);
      const list = [...(next.get(chatId) ?? []), ref];
      next.set(chatId, list);
      return { queuedMessages: next };
    }),
  removeQueuedMessage: (chatId, uuid) =>
    set((state) => {
      const next = new Map(state.queuedMessages);
      const list = (next.get(chatId) ?? []).filter((r) => r.uuid !== uuid);
      if (list.length > 0) {
        next.set(chatId, list);
      } else {
        next.delete(chatId);
      }
      return { queuedMessages: next };
    }),
  clearQueuedMessages: (chatId) =>
    set((state) => {
      const next = new Map(state.queuedMessages);
      next.delete(chatId);
      return { queuedMessages: next };
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
  setTodos: (chatId, todos) =>
    set((state) => {
      const next = new Map(state.todos);
      next.set(chatId, todos);
      return { todos: next };
    }),
  addDetectedPr: (chatId, pr) =>
    set((state) => {
      const next = new Map(state.detectedPrs);
      const existing = next.get(chatId) ?? [];
      const idx = existing.findIndex((p) => p.owner === pr.owner && p.repo === pr.repo && p.number === pr.number);
      if (idx >= 0) {
        // Upgrade mentioned → created if applicable
        if (existing[idx]!.source === 'mentioned' && pr.source === 'created') {
          const updated = [...existing];
          updated[idx] = pr;
          next.set(chatId, updated);
          return { detectedPrs: next };
        }
        return state;
      }
      next.set(chatId, [...existing, pr]);
      return { detectedPrs: next };
    }),
}));
