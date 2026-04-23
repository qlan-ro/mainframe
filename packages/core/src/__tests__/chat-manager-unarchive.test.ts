import { describe, it, expect, vi } from 'vitest';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { ChatManager } from '../chat/chat-manager.js';

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
  const get = vi.fn().mockReturnValue(undefined);
  return { get, list: vi.fn(), all: vi.fn().mockReturnValue([]) } as unknown as AdapterRegistry;
}

describe('ChatManager.unarchiveChat', () => {
  it('flips the chat status to active in the DB', () => {
    const restoredChat = { id: 'c1', projectId: 'p1', status: 'active' };
    const db = makeDb(restoredChat);
    const manager = new ChatManager(db, makeAdapters());

    manager.unarchiveChat('c1');

    expect(db.chats.update).toHaveBeenCalledWith('c1', { status: 'active' });
  });

  it('emits a chat.updated event so clients learn about the new status', () => {
    const restoredChat = { id: 'c1', projectId: 'p1', status: 'active' };
    const db = makeDb(restoredChat);
    const events: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), undefined, (e) => events.push(e));

    manager.unarchiveChat('c1');

    const updated = events.find((e) => e.type === 'chat.updated');
    expect(updated).toBeDefined();
    expect(updated).toMatchObject({ type: 'chat.updated', chat: restoredChat });
  });

  it('returns the refreshed chat', () => {
    const restoredChat = { id: 'c1', projectId: 'p1', status: 'active' };
    const db = makeDb(restoredChat);
    const manager = new ChatManager(db, makeAdapters());

    expect(manager.unarchiveChat('c1')).toEqual(restoredChat);
  });

  it('returns null and emits nothing when the chat does not exist', () => {
    const db = makeDb(null);
    const events: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), undefined, (e) => events.push(e));

    expect(manager.unarchiveChat('missing')).toBeNull();
    expect(events.find((e) => e.type === 'chat.updated')).toBeUndefined();
  });
});
