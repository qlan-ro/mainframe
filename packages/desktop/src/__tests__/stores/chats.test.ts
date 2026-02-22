import { describe, it, expect, beforeEach } from 'vitest';
import type { Chat, ChatMessage, ControlRequest, AdapterProcess } from '@mainframe/types';
import { useChatsStore } from '../../renderer/store/chats.js';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'user',
    content: [{ type: 'text', text: 'hello' }],
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePermission(overrides: Partial<ControlRequest> = {}): ControlRequest {
  return {
    requestId: 'req-1',
    toolName: 'bash',
    toolUseId: 'tu-1',
    input: { command: 'ls' },
    suggestions: [],
    ...overrides,
  };
}

function makeProcess(overrides: Partial<AdapterProcess> = {}): AdapterProcess {
  return {
    id: 'proc-1',
    adapterId: 'claude',
    chatId: 'chat-1',
    pid: 12345,
    status: 'running',
    projectPath: '/tmp/project',
    ...overrides,
  };
}

function resetStore(): void {
  useChatsStore.setState({
    chats: [],
    activeChatId: null,
    messages: new Map(),
    pendingPermissions: new Map(),
    processes: new Map(),
  });
}

describe('useChatsStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with empty chats array', () => {
      expect(useChatsStore.getState().chats).toEqual([]);
    });

    it('starts with null activeChatId', () => {
      expect(useChatsStore.getState().activeChatId).toBeNull();
    });

    it('starts with empty messages map', () => {
      expect(useChatsStore.getState().messages.size).toBe(0);
    });

    it('starts with empty pendingPermissions map', () => {
      expect(useChatsStore.getState().pendingPermissions.size).toBe(0);
    });

    it('starts with empty processes map', () => {
      expect(useChatsStore.getState().processes.size).toBe(0);
    });
  });

  describe('setChats', () => {
    it('sets the chats array', () => {
      const chats = [makeChat({ id: 'a' }), makeChat({ id: 'b' })];
      useChatsStore.getState().setChats(chats);
      expect(useChatsStore.getState().chats).toEqual(chats);
    });

    it('replaces existing chats', () => {
      useChatsStore.getState().setChats([makeChat({ id: 'old' })]);
      const newChats = [makeChat({ id: 'new' })];
      useChatsStore.getState().setChats(newChats);
      expect(useChatsStore.getState().chats).toEqual(newChats);
      expect(useChatsStore.getState().chats).toHaveLength(1);
    });
  });

  describe('setActiveChat', () => {
    it('sets the active chat id', () => {
      useChatsStore.getState().setActiveChat('chat-1');
      expect(useChatsStore.getState().activeChatId).toBe('chat-1');
    });

    it('clears the active chat id with null', () => {
      useChatsStore.getState().setActiveChat('chat-1');
      useChatsStore.getState().setActiveChat(null);
      expect(useChatsStore.getState().activeChatId).toBeNull();
    });
  });

  describe('addChat', () => {
    it('prepends a chat to the list', () => {
      const chatA = makeChat({ id: 'a' });
      const chatB = makeChat({ id: 'b' });
      useChatsStore.getState().addChat(chatA);
      useChatsStore.getState().addChat(chatB);
      const ids = useChatsStore.getState().chats.map((c: Chat) => c.id);
      expect(ids).toEqual(['b', 'a']);
    });
  });

  describe('updateChat', () => {
    it('replaces an existing chat and moves it to the front', () => {
      const chatA = makeChat({ id: 'a', title: 'old' });
      const chatB = makeChat({ id: 'b' });
      useChatsStore.getState().setChats([chatA, chatB]);

      const updated = makeChat({ id: 'a', title: 'new' });
      useChatsStore.getState().updateChat(updated);

      const state = useChatsStore.getState();
      expect(state.chats[0]!.id).toBe('a');
      expect(state.chats[0]!.title).toBe('new');
      expect(state.chats).toHaveLength(2);
    });

    it('adds a chat if it does not exist', () => {
      const chat = makeChat({ id: 'new' });
      useChatsStore.getState().updateChat(chat);
      expect(useChatsStore.getState().chats).toHaveLength(1);
      expect(useChatsStore.getState().chats[0]!.id).toBe('new');
    });
  });

  describe('removeChat', () => {
    it('removes a chat by id', () => {
      useChatsStore.getState().setChats([makeChat({ id: 'a' }), makeChat({ id: 'b' })]);
      useChatsStore.getState().removeChat('a');
      const ids = useChatsStore.getState().chats.map((c: Chat) => c.id);
      expect(ids).toEqual(['b']);
    });

    it('clears activeChatId when active chat is removed', () => {
      useChatsStore.getState().setChats([makeChat({ id: 'a' })]);
      useChatsStore.getState().setActiveChat('a');
      useChatsStore.getState().removeChat('a');
      expect(useChatsStore.getState().activeChatId).toBeNull();
    });

    it('preserves activeChatId when a different chat is removed', () => {
      useChatsStore.getState().setChats([makeChat({ id: 'a' }), makeChat({ id: 'b' })]);
      useChatsStore.getState().setActiveChat('a');
      useChatsStore.getState().removeChat('b');
      expect(useChatsStore.getState().activeChatId).toBe('a');
    });
  });

  describe('messages', () => {
    it('addMessage appends a message to the chat', () => {
      const msg = makeMessage({ id: 'msg-1', chatId: 'chat-1' });
      useChatsStore.getState().addMessage('chat-1', msg);
      const msgs = useChatsStore.getState().messages.get('chat-1');
      expect(msgs).toEqual([msg]);
    });

    it('addMessage appends to existing messages', () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      useChatsStore.getState().addMessage('chat-1', msg1);
      useChatsStore.getState().addMessage('chat-1', msg2);
      const msgs = useChatsStore.getState().messages.get('chat-1');
      expect(msgs).toHaveLength(2);
      expect(msgs?.[0]?.id).toBe('msg-1');
      expect(msgs?.[1]?.id).toBe('msg-2');
    });

    it('setMessages replaces messages for a chat', () => {
      useChatsStore.getState().addMessage('chat-1', makeMessage({ id: 'old' }));
      const newMsgs = [makeMessage({ id: 'new' })];
      useChatsStore.getState().setMessages('chat-1', newMsgs);
      const msgs = useChatsStore.getState().messages.get('chat-1');
      expect(msgs).toEqual(newMsgs);
    });

    it('setMessages does not affect other chats', () => {
      useChatsStore.getState().addMessage('chat-1', makeMessage({ id: 'a' }));
      useChatsStore.getState().setMessages('chat-2', [makeMessage({ id: 'b', chatId: 'chat-2' })]);
      expect(useChatsStore.getState().messages.get('chat-1')).toHaveLength(1);
      expect(useChatsStore.getState().messages.get('chat-2')).toHaveLength(1);
    });
  });

  describe('pendingPermissions', () => {
    it('addPendingPermission stores a permission request', () => {
      const perm = makePermission();
      useChatsStore.getState().addPendingPermission('chat-1', perm);
      expect(useChatsStore.getState().pendingPermissions.get('chat-1')).toEqual(perm);
    });

    it('removePendingPermission clears the permission', () => {
      useChatsStore.getState().addPendingPermission('chat-1', makePermission());
      useChatsStore.getState().removePendingPermission('chat-1');
      expect(useChatsStore.getState().pendingPermissions.has('chat-1')).toBe(false);
    });

    it('addPendingPermission overwrites previous permission for same chat', () => {
      const perm1 = makePermission({ requestId: 'req-1' });
      const perm2 = makePermission({ requestId: 'req-2' });
      useChatsStore.getState().addPendingPermission('chat-1', perm1);
      useChatsStore.getState().addPendingPermission('chat-1', perm2);
      expect(useChatsStore.getState().pendingPermissions.get('chat-1')!.requestId).toBe('req-2');
    });
  });

  describe('processes', () => {
    it('setProcess stores a process for a chat', () => {
      const proc = makeProcess();
      useChatsStore.getState().setProcess('chat-1', proc);
      expect(useChatsStore.getState().processes.get('chat-1')).toEqual(proc);
    });

    it('removeProcess deletes the process', () => {
      useChatsStore.getState().setProcess('chat-1', makeProcess());
      useChatsStore.getState().removeProcess('chat-1');
      expect(useChatsStore.getState().processes.has('chat-1')).toBe(false);
    });

    it('updateProcessStatus updates status by processId', () => {
      const proc = makeProcess({ id: 'proc-1', status: 'running' });
      useChatsStore.getState().setProcess('chat-1', proc);
      useChatsStore.getState().updateProcessStatus('proc-1', 'stopped');
      expect(useChatsStore.getState().processes.get('chat-1')!.status).toBe('stopped');
    });

    it('updateProcessStatus does nothing if processId not found', () => {
      const proc = makeProcess({ id: 'proc-1', status: 'running' });
      useChatsStore.getState().setProcess('chat-1', proc);
      useChatsStore.getState().updateProcessStatus('nonexistent', 'stopped');
      expect(useChatsStore.getState().processes.get('chat-1')!.status).toBe('running');
    });
  });
});
