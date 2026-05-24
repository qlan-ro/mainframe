import { describe, it, expect, vi } from 'vitest';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { ChatManager } from '../chat/chat-manager.js';
import type { ActiveChat } from '../chat/types.js';

function makeDb(chat: Record<string, unknown> | null): DatabaseManager {
  return {
    chats: {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(chat),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      addMention: vi.fn(),
    },
    projects: {
      list: vi.fn(),
      get: vi.fn(),
      getByPath: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
      removeWithChats: vi.fn(),
      updateLastOpened: vi.fn(),
    },
    settings: { get: vi.fn(), getByCategory: vi.fn(), set: vi.fn(), delete: vi.fn() },
  } as unknown as DatabaseManager;
}

function makeAdapters(): AdapterRegistry {
  return {
    get: vi.fn().mockReturnValue(undefined),
    list: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  } as unknown as AdapterRegistry;
}

describe('ChatManager.syncChatFields', () => {
  it('updates cached active chat fields so a later chat.updated emission is not stale', () => {
    const cached = { id: 'c1', projectId: 'p1', status: 'active', pinned: false };
    const db = makeDb(cached);
    const manager = new ChatManager(db, makeAdapters());
    // Inject an active chat directly — going through loadChat would require a
    // full adapter session. The bug under test is purely about cache freshness.
    const activeChats = (manager as unknown as { activeChats: Map<string, ActiveChat> }).activeChats;
    activeChats.set('c1', { chat: { ...cached } } as unknown as ActiveChat);

    manager.syncChatFields('c1', { pinned: true });

    expect(activeChats.get('c1')?.chat.pinned).toBe(true);
    // getChat reads from the cache when present — proves resumeChat would emit fresh data.
    expect(manager.getChat('c1')).toMatchObject({ pinned: true });
  });

  it('is a no-op when the chat is not in the active cache', () => {
    const db = makeDb({ id: 'c1', projectId: 'p1', status: 'active', pinned: false });
    const manager = new ChatManager(db, makeAdapters());

    expect(() => manager.syncChatFields('c1', { pinned: true })).not.toThrow();
  });

  it('merges partial updates without dropping unrelated fields', () => {
    const cached = { id: 'c1', projectId: 'p1', status: 'active', pinned: false, effort: 'low', title: 'keep me' };
    const db = makeDb(cached);
    const manager = new ChatManager(db, makeAdapters());
    const activeChats = (manager as unknown as { activeChats: Map<string, ActiveChat> }).activeChats;
    activeChats.set('c1', { chat: { ...cached } } as unknown as ActiveChat);

    manager.syncChatFields('c1', { effort: 'high' });

    const cachedNow = activeChats.get('c1')?.chat as unknown as Record<string, unknown>;
    expect(cachedNow.effort).toBe('high');
    expect(cachedNow.title).toBe('keep me');
    expect(cachedNow.pinned).toBe(false);
  });
});
