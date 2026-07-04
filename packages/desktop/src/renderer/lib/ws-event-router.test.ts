import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent, Chat } from '@qlan-ro/mainframe-types';

const setActiveChat = vi.fn();
const addChat = vi.fn();
const openChatTab = vi.fn();
const updateTabLabel = vi.fn();
const getClientId = vi.fn<() => string | undefined>();
const updateAdapterModels = vi.fn();

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
  useAdaptersStore: { getState: () => ({ updateAdapterModels }) },
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

describe('routeEvent — chat.created is pure list-sync (WS8)', () => {
  // Post-WS8, navigation is driven by the REST caller (startChat / Todos
  // start-session), not by this broadcast. chat.created only upserts the chat
  // into the list — it never navigates, regardless of source.
  it('upserts the chat and does NOT navigate', () => {
    const event: DaemonEvent = { type: 'chat.created', chat: baseChat };
    routeEvent(event);
    expect(addChat).toHaveBeenCalledWith(baseChat);
    expect(setActiveChat).not.toHaveBeenCalled();
    expect(openChatTab).not.toHaveBeenCalled();
  });

  it('does NOT navigate for imports either', () => {
    const event: DaemonEvent = { type: 'chat.created', chat: baseChat, source: 'import' };
    routeEvent(event);
    expect(addChat).toHaveBeenCalledWith(baseChat);
    expect(setActiveChat).not.toHaveBeenCalled();
    expect(openChatTab).not.toHaveBeenCalled();
  });
});

describe('routeEvent — adapter.models.updated forwards the revision', () => {
  it('passes adapterId, models, and modelsRevision to the store', () => {
    const models = [{ id: 'm1', label: 'M1' }];
    const event: DaemonEvent = { type: 'adapter.models.updated', adapterId: 'claude', models, modelsRevision: 4 };
    routeEvent(event);
    expect(updateAdapterModels).toHaveBeenCalledWith('claude', models, 4);
  });
});
