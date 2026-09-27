/**
 * side-chat-ids — the pure identity check plus the runtime registry that lets
 * a caller holding only an id recognize a side chat (todo #344).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import {
  __resetSideChatRegistryForTests,
  isRegisteredSideChatId,
  isSideChat,
  parentOfSideChat,
  recordSideChatsFromList,
  registerSideChat,
  unregisterSideChat,
} from '../side-chat-ids';

afterEach(() => {
  __resetSideChatRegistryForTests();
});

describe('isSideChat', () => {
  it('is true for a temporary chat with a parent', () => {
    expect(isSideChat({ temporary: true, parentChatId: 'chat-parent' })).toBe(true);
  });
  it('is false for a temporary chat with no parent (a plain temporary chat, todo #346)', () => {
    expect(isSideChat({ temporary: true, parentChatId: null })).toBe(false);
    expect(isSideChat({ temporary: true })).toBe(false);
  });
  it('is false for a non-temporary chat with a parent (a fork, todo #343)', () => {
    expect(isSideChat({ temporary: false, parentChatId: 'chat-parent' })).toBe(false);
  });
});

describe('side-chat registry', () => {
  it('is empty until a mapping is registered', () => {
    expect(isRegisteredSideChatId('chat-side-1')).toBe(false);
    expect(parentOfSideChat('chat-side-1')).toBeUndefined();
  });

  it('records and looks up a registered mapping', () => {
    registerSideChat('chat-side-1', 'chat-parent');

    expect(isRegisteredSideChatId('chat-side-1')).toBe(true);
    expect(parentOfSideChat('chat-side-1')).toBe('chat-parent');
  });

  it('forgets a mapping on unregister', () => {
    registerSideChat('chat-side-1', 'chat-parent');

    unregisterSideChat('chat-side-1');

    expect(isRegisteredSideChatId('chat-side-1')).toBe(false);
  });

  it('recordSideChatsFromList registers every chat that carries a sideChatId', () => {
    const chats = [
      { id: 'chat-parent-1', sideChatId: 'chat-side-1' },
      { id: 'chat-parent-2', sideChatId: null },
      { id: 'chat-parent-3' },
    ] as Chat[];

    recordSideChatsFromList(chats);

    expect(parentOfSideChat('chat-side-1')).toBe('chat-parent-1');
    expect(isRegisteredSideChatId('chat-parent-2')).toBe(false);
    expect(isRegisteredSideChatId('chat-parent-3')).toBe(false);
  });
});
