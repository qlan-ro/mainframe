import { describe, it, expect, beforeEach } from 'vitest';
import { useChatsStore } from './chats';
import type { Chat } from '@qlan-ro/mainframe-types';

function makeChat(id: string, updatedAt: string, pinned = false): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId: 'proj-1',
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
