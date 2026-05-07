import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent, Chat } from '@qlan-ro/mainframe-types';

const setActiveChat = vi.fn();
const addChat = vi.fn();
const openChatTab = vi.fn();
const updateTabLabel = vi.fn();
const getClientId = vi.fn<() => string | undefined>();

vi.mock('../store/chats', () => ({
  useChatsStore: {
    getState: () => ({
      addChat,
      setActiveChat,
      chats: [],
      pendingPermissions: new Map(),
      removePendingPermission: vi.fn(),
      addPendingPermission: vi.fn(),
      removeChat: vi.fn(),
      removeProcess: vi.fn(),
      addMessage: vi.fn(),
      updateMessage: vi.fn(),
      setMessages: vi.fn(),
      updateChat: vi.fn(),
      setProcess: vi.fn(),
      updateProcessStatus: vi.fn(),
      setCompacting: vi.fn(),
      setContextUsage: vi.fn(),
      setTodos: vi.fn(),
      addDetectedPr: vi.fn(),
      addQueuedMessage: vi.fn(),
      removeQueuedMessage: vi.fn(),
      clearQueuedMessages: vi.fn(),
      setQueuedMessages: vi.fn(),
    }),
  },
}));

vi.mock('../store/tabs', () => ({
  useTabsStore: {
    getState: () => ({
      openChatTab,
      updateTabLabel,
    }),
  },
}));

vi.mock('../store/projects', () => ({
  useProjectsStore: { getState: () => ({ setError: vi.fn() }) },
}));

vi.mock('../store/plugins', () => ({
  usePluginLayoutStore: {
    getState: () => ({
      registerContribution: vi.fn(),
      unregisterContribution: vi.fn(),
      registerAction: vi.fn(),
      unregisterAction: vi.fn(),
    }),
  },
}));

vi.mock('../store/sandbox', () => ({
  useSandboxStore: { getState: () => ({ appendLog: vi.fn(), setProcessStatus: vi.fn() }) },
}));

vi.mock('../store/adapters', () => ({
  useAdaptersStore: { getState: () => ({ updateAdapterModels: vi.fn() }) },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('./launch-scope.js', () => ({
  buildLaunchScope: vi.fn(() => 'scope'),
}));

vi.mock('./notify', () => ({ notify: vi.fn() }));

vi.mock('./client', () => ({
  daemonClient: { getClientId: () => getClientId() },
}));

import { routeEvent } from './ws-event-router';

const baseChat: Chat = {
  id: 'chat-A',
  adapterId: 'claude',
  projectId: 'p-1',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
};

beforeEach(() => {
  setActiveChat.mockClear();
  addChat.mockClear();
  openChatTab.mockClear();
  getClientId.mockReset();
});

describe('routeEvent — chat.created auto-select gate', () => {
  it('auto-selects when originClientId matches our own clientId', () => {
    getClientId.mockReturnValue('client-self');
    const event: DaemonEvent = { type: 'chat.created', chat: baseChat, originClientId: 'client-self' };
    routeEvent(event);
    expect(addChat).toHaveBeenCalledWith(baseChat);
    expect(setActiveChat).toHaveBeenCalledWith(baseChat.id);
    expect(openChatTab).toHaveBeenCalledWith(baseChat.id, baseChat.title);
  });

  it('does NOT auto-select when originClientId belongs to another client', () => {
    getClientId.mockReturnValue('client-self');
    const event: DaemonEvent = { type: 'chat.created', chat: baseChat, originClientId: 'client-other' };
    routeEvent(event);
    expect(addChat).toHaveBeenCalledWith(baseChat);
    expect(setActiveChat).not.toHaveBeenCalled();
    expect(openChatTab).not.toHaveBeenCalled();
  });

  it('auto-selects when originClientId is undefined (legacy / plugin HTTP path)', () => {
    // Plugin-driven HTTP routes (e.g. POST /todos/:id/start-session) emit
    // chat.created outside the WS AsyncLocalStorage scope, so origin is
    // undefined. We treat that as "this client" so the user clicking
    // "Start session" still gets navigation.
    getClientId.mockReturnValue('client-self');
    const event: DaemonEvent = { type: 'chat.created', chat: baseChat };
    routeEvent(event);
    expect(setActiveChat).toHaveBeenCalledWith(baseChat.id);
    expect(openChatTab).toHaveBeenCalledWith(baseChat.id, baseChat.title);
  });

  it('does NOT auto-select for imports even when origin matches', () => {
    getClientId.mockReturnValue('client-self');
    const event: DaemonEvent = {
      type: 'chat.created',
      chat: baseChat,
      source: 'import',
      originClientId: 'client-self',
    };
    routeEvent(event);
    expect(setActiveChat).not.toHaveBeenCalled();
    expect(openChatTab).not.toHaveBeenCalled();
  });

  it('does NOT auto-select for imports even when origin is undefined', () => {
    getClientId.mockReturnValue('client-self');
    const event: DaemonEvent = { type: 'chat.created', chat: baseChat, source: 'import' };
    routeEvent(event);
    expect(setActiveChat).not.toHaveBeenCalled();
    expect(openChatTab).not.toHaveBeenCalled();
  });
});
