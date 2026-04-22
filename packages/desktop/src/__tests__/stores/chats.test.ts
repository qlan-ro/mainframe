import { describe, it, expect, beforeEach } from 'vitest';
import type { Chat, ControlRequest, AdapterProcess, DisplayMessage } from '@qlan-ro/mainframe-types';
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
    lastContextTokensInput: 0,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
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
    filterProjectId: null,
    messages: new Map(),
    pendingPermissions: new Map(),
    processes: new Map(),
    queuedMessages: new Map(),
    compactingChats: new Set(),
    contextUsage: new Map(),
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

    it('starts with null filterProjectId', () => {
      expect(useChatsStore.getState().filterProjectId).toBeNull();
    });
  });

  describe('setFilterProjectId', () => {
    it('sets the filter project id', () => {
      useChatsStore.getState().setFilterProjectId('proj-1');
      expect(useChatsStore.getState().filterProjectId).toBe('proj-1');
    });

    it('clears the filter project id with null', () => {
      useChatsStore.getState().setFilterProjectId('proj-1');
      useChatsStore.getState().setFilterProjectId(null);
      expect(useChatsStore.getState().filterProjectId).toBeNull();
    });

    it('persists across store reads (survives component unmount)', () => {
      useChatsStore.getState().setFilterProjectId('proj-2');
      // Simulate what happens when ChatsPanel remounts: read from store
      const retrieved = useChatsStore.getState().filterProjectId;
      expect(retrieved).toBe('proj-2');
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
    it('inserts chat at correct chronological position', () => {
      const chatA = makeChat({ id: 'a', updatedAt: '2026-01-02T00:00:00Z' });
      const chatB = makeChat({ id: 'b', updatedAt: '2026-01-01T00:00:00Z' });
      useChatsStore.getState().addChat(chatA);
      useChatsStore.getState().addChat(chatB);
      const ids = useChatsStore.getState().chats.map((c: Chat) => c.id);
      expect(ids).toEqual(['a', 'b']);
    });

    it('prepends when timestamps are equal', () => {
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

    it('cleans up messages for removed chat', () => {
      useChatsStore.getState().addMessage('chat-a', makeMessage({ id: 'msg-1', chatId: 'chat-a' }));
      useChatsStore.getState().addMessage('chat-b', makeMessage({ id: 'msg-2', chatId: 'chat-b' }));
      useChatsStore.getState().removeChat('chat-a');
      expect(useChatsStore.getState().messages.has('chat-a')).toBe(false);
      expect(useChatsStore.getState().messages.has('chat-b')).toBe(true);
    });

    it('cleans up pendingPermissions for removed chat', () => {
      useChatsStore.getState().addPendingPermission('chat-a', makePermission());
      useChatsStore.getState().removeChat('chat-a');
      expect(useChatsStore.getState().pendingPermissions.has('chat-a')).toBe(false);
    });

    it('cleans up processes for removed chat', () => {
      useChatsStore.getState().setProcess('chat-a', makeProcess({ chatId: 'chat-a' }));
      useChatsStore.getState().removeChat('chat-a');
      expect(useChatsStore.getState().processes.has('chat-a')).toBe(false);
    });

    it('cleans up queuedMessages for removed chat', () => {
      useChatsStore.getState().addQueuedMessage('chat-a', { uuid: 'q1', content: 'hi' } as any);
      useChatsStore.getState().removeChat('chat-a');
      expect(useChatsStore.getState().queuedMessages.has('chat-a')).toBe(false);
    });

    it('cleans up contextUsage for removed chat', () => {
      useChatsStore.getState().setContextUsage('chat-a', { percentage: 50, totalTokens: 100, maxTokens: 200 });
      useChatsStore.getState().removeChat('chat-a');
      expect(useChatsStore.getState().contextUsage.has('chat-a')).toBe(false);
    });

    it('cleans up compactingChats for removed chat', () => {
      useChatsStore.getState().setCompacting('chat-a', true);
      useChatsStore.getState().removeChat('chat-a');
      expect(useChatsStore.getState().compactingChats.has('chat-a')).toBe(false);
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

  describe('message eviction', () => {
    it('caps messages per chat at MAX_MESSAGES_PER_CHAT', () => {
      const chatId = 'chat-1';
      for (let i = 0; i < 2001; i++) {
        useChatsStore.getState().addMessage(chatId, makeMessage({ id: `msg-${i}`, chatId }));
      }
      const msgs = useChatsStore.getState().messages.get(chatId)!;
      expect(msgs).toHaveLength(2000);
      expect(msgs[msgs.length - 1]!.id).toBe('msg-2000');
      expect(msgs[0]!.id).toBe('msg-1');
    });

    it('setMessages caps at MAX_MESSAGES_PER_CHAT', () => {
      const msgs = Array.from({ length: 2500 }, (_, i) => makeMessage({ id: `msg-${i}`, chatId: 'chat-1' }));
      useChatsStore.getState().setMessages('chat-1', msgs);
      expect(useChatsStore.getState().messages.get('chat-1')).toHaveLength(2000);
    });

    it('evicts oldest chat messages when MAX_DISPLAY_CHATS exceeded', () => {
      for (let i = 0; i < 51; i++) {
        useChatsStore.getState().addMessage(`chat-${i}`, makeMessage({ id: `msg-${i}`, chatId: `chat-${i}` }));
      }
      expect(useChatsStore.getState().messages.size).toBeLessThanOrEqual(50);
    });
  });

  describe('filterProjectId / activeChatId boot-time reconciliation', () => {
    // Simulates the sequence executed by useAppInit.loadData() on startup.
    // The fix ensures that when the restored active chat belongs to a different
    // project than the persisted filterProjectId, the filter is updated to match
    // the active chat so the badge and the chat list stay in sync.

    function simulateBoot(chats: Chat[], activeChatId: string, initialFilterProjectId: string | null): void {
      useChatsStore.setState({ filterProjectId: initialFilterProjectId });
      useChatsStore.getState().setChats(chats);
      useChatsStore.getState().setActiveChat(activeChatId);

      // Reconciliation logic (mirrors useAppInit loadData)
      const restoredChat = chats.find((c) => c.id === activeChatId);
      if (restoredChat) {
        const { filterProjectId, setFilterProjectId } = useChatsStore.getState();
        if (filterProjectId !== null && filterProjectId !== restoredChat.projectId) {
          setFilterProjectId(restoredChat.projectId);
        }
      }
    }

    it('updates filterProjectId when it disagrees with the restored active chat project', () => {
      const chatA = makeChat({ id: 'chat-a', projectId: 'proj-a' });
      const chatB = makeChat({ id: 'chat-b', projectId: 'proj-b' });

      // User had proj-a filtered, but last active chat is in proj-b
      simulateBoot([chatA, chatB], 'chat-b', 'proj-a');

      expect(useChatsStore.getState().filterProjectId).toBe('proj-b');
      expect(useChatsStore.getState().activeChatId).toBe('chat-b');
    });

    it('leaves filterProjectId unchanged when it already matches the restored active chat', () => {
      const chatA = makeChat({ id: 'chat-a', projectId: 'proj-a' });

      simulateBoot([chatA], 'chat-a', 'proj-a');

      expect(useChatsStore.getState().filterProjectId).toBe('proj-a');
    });

    it('leaves filterProjectId null (All) untouched regardless of active chat project', () => {
      const chatA = makeChat({ id: 'chat-a', projectId: 'proj-a' });

      // filterProjectId === null means "All" — not a user-set project filter,
      // so no reconciliation should occur.
      simulateBoot([chatA], 'chat-a', null);

      expect(useChatsStore.getState().filterProjectId).toBeNull();
    });

    it('handles fall-back-to-most-recent path: filter updated to match most recent chat project', () => {
      const chatOld = makeChat({ id: 'chat-old', projectId: 'proj-a', updatedAt: '2026-01-01T00:00:00Z' });
      const chatNew = makeChat({ id: 'chat-new', projectId: 'proj-b', updatedAt: '2026-01-02T00:00:00Z' });

      // Simulate: stale activeChatId not in list → fall back to most recent
      const chatsList = [chatOld, chatNew];
      useChatsStore.setState({ filterProjectId: 'proj-a' });
      useChatsStore.getState().setChats(chatsList);

      const sorted = [...chatsList].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const mostRecent = sorted[0]!;
      useChatsStore.getState().setActiveChat(mostRecent.id);

      // Reconciliation
      const { filterProjectId, setFilterProjectId } = useChatsStore.getState();
      if (filterProjectId !== null && filterProjectId !== mostRecent.projectId) {
        setFilterProjectId(mostRecent.projectId);
      }

      expect(useChatsStore.getState().activeChatId).toBe('chat-new');
      expect(useChatsStore.getState().filterProjectId).toBe('proj-b');
    });
  });
});
