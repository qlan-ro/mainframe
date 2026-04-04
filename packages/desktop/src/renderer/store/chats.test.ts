import { describe, it, expect, beforeEach } from 'vitest';
import { useChatsStore } from './chats';

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
