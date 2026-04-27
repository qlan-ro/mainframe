import { describe, it, expect, beforeEach } from 'vitest';
import { useChatsStore } from './chats';
import type { Chat } from '@qlan-ro/mainframe-types';

function makeChat(id: string, updatedAt: string, pinned = false, projectId = 'proj-1'): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId,
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    pinned,
    processState: null,
  };
}

describe('chat ordering', () => {
  beforeEach(() => {
    useChatsStore.setState({ chats: [], activeChatId: null });
  });

  it('setChats sorts by updatedAt DESC', () => {
    const older = makeChat('a', '2024-01-01T00:00:00.000Z');
    const newer = makeChat('b', '2024-06-01T00:00:00.000Z');
    useChatsStore.getState().setChats([older, newer]);
    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids).toEqual(['b', 'a']);
  });

  it('setChats puts pinned chats first regardless of updatedAt', () => {
    const recentUnpinned = makeChat('recent', '2024-06-01T00:00:00.000Z', false);
    const oldPinned = makeChat('pinned', '2024-01-01T00:00:00.000Z', true);
    useChatsStore.getState().setChats([recentUnpinned, oldPinned]);
    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids[0]).toBe('pinned');
    expect(ids[1]).toBe('recent');
  });

  it('updateChat re-sorts list when updatedAt changes', () => {
    const chatA = makeChat('a', '2024-06-01T00:00:00.000Z');
    const chatB = makeChat('b', '2024-01-01T00:00:00.000Z');
    useChatsStore.setState({ chats: [chatA, chatB] });

    // Chat B gets new activity — bumped to a later timestamp
    const updatedB = { ...chatB, updatedAt: '2024-12-01T00:00:00.000Z' };
    useChatsStore.getState().updateChat(updatedB);

    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids[0]).toBe('b');
    expect(ids[1]).toBe('a');
  });

  it('updateChat does not re-sort when updatedAt is unchanged', () => {
    const chatA = makeChat('a', '2024-06-01T00:00:00.000Z');
    const chatB = makeChat('b', '2024-01-01T00:00:00.000Z');
    useChatsStore.setState({ chats: [chatA, chatB] });

    // Only title changed — no re-sort expected
    const updatedB = { ...chatB, title: 'New Title' };
    useChatsStore.getState().updateChat(updatedB);

    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids[0]).toBe('a');
    expect(ids[1]).toBe('b');
  });
});

describe('loadingChats', () => {
  beforeEach(() => {
    useChatsStore.setState({ loadingChats: new Set() });
  });

  it('setLoadingChat(true) marks chat as loading', () => {
    useChatsStore.getState().setLoadingChat('chat-1', true);
    expect(useChatsStore.getState().loadingChats.has('chat-1')).toBe(true);
  });

  it('setLoadingChat(false) removes chat from loading set', () => {
    useChatsStore.getState().setLoadingChat('chat-1', true);
    useChatsStore.getState().setLoadingChat('chat-1', false);
    expect(useChatsStore.getState().loadingChats.has('chat-1')).toBe(false);
  });

  it('tracks multiple chats independently', () => {
    useChatsStore.getState().setLoadingChat('chat-1', true);
    useChatsStore.getState().setLoadingChat('chat-2', true);
    useChatsStore.getState().setLoadingChat('chat-1', false);
    expect(useChatsStore.getState().loadingChats.has('chat-1')).toBe(false);
    expect(useChatsStore.getState().loadingChats.has('chat-2')).toBe(true);
  });

  it('setLoadingChat(false) on unknown chat is a no-op', () => {
    useChatsStore.getState().setLoadingChat('chat-x', false);
    expect(useChatsStore.getState().loadingChats.size).toBe(0);
  });
});

describe('unread state', () => {
  beforeEach(() => {
    useChatsStore.setState({
      unreadChatIds: new Set(),
      chats: [],
      activeChatId: null,
    });
  });

  it('markUnread adds chatId to set', () => {
    useChatsStore.getState().markUnread('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-1')).toBe(true);
  });

  it('clearUnread removes chatId from set', () => {
    useChatsStore.getState().markUnread('chat-1');
    useChatsStore.getState().clearUnread('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-1')).toBe(false);
  });

  it('setActiveChat clears unread for that chat', () => {
    useChatsStore.getState().markUnread('chat-1');
    useChatsStore.getState().setActiveChat('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-1')).toBe(false);
  });

  it('setActiveChat does not affect other chats', () => {
    useChatsStore.getState().markUnread('chat-1');
    useChatsStore.getState().markUnread('chat-2');
    useChatsStore.getState().setActiveChat('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-2')).toBe(true);
  });
});

describe('filterProjectId reconciliation on setActiveChat', () => {
  beforeEach(() => {
    localStorage.clear();
    useChatsStore.setState({
      chats: [
        makeChat('chat-a', '2024-01-01T00:00:00.000Z', false, 'proj-A'),
        makeChat('chat-b', '2024-01-01T00:00:00.000Z', false, 'proj-B'),
      ],
      activeChatId: null,
      filterProjectId: null,
    });
  });

  it("clears filterProjectId when active chat's project differs from the filter", () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat('chat-b');
    expect(useChatsStore.getState().filterProjectId).toBeNull();
    expect(localStorage.getItem('mf:filterProjectId')).toBeNull();
  });

  it("leaves filterProjectId unchanged when active chat's project matches the filter", () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat('chat-a');
    expect(useChatsStore.getState().filterProjectId).toBe('proj-A');
  });

  it('leaves filterProjectId unchanged when no filter is set', () => {
    useChatsStore.getState().setActiveChat('chat-b');
    expect(useChatsStore.getState().filterProjectId).toBeNull();
  });

  it('leaves filterProjectId unchanged when active chat is cleared', () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat(null);
    expect(useChatsStore.getState().filterProjectId).toBe('proj-A');
  });

  it('leaves filterProjectId unchanged when target chat is unknown', () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat('chat-missing');
    expect(useChatsStore.getState().filterProjectId).toBe('proj-A');
  });
});
