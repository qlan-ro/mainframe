import { BackgroundTaskTracker } from '../background-tasks/tracker.js';
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
      updateLastOpened: vi.fn(),
    },
    settings: { get: vi.fn(), getByCategory: vi.fn(), set: vi.fn(), delete: vi.fn() },
  } as unknown as DatabaseManager;
}

function makeAdapters(): AdapterRegistry {
  const get = vi.fn().mockReturnValue(undefined);
  return { get, list: vi.fn(), all: vi.fn().mockReturnValue([]) } as unknown as AdapterRegistry;
}

describe('ChatManager.renameChat', () => {
  it('persists the new title in the DB', () => {
    const renamedChat = { id: 'c1', projectId: 'p1', title: 'New title' };
    const db = makeDb(renamedChat);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    manager.renameChat('c1', 'New title');

    expect(db.chats.update).toHaveBeenCalledWith('c1', { title: 'New title' });
  });

  it('emits a chat.updated event so connected clients see the rename', () => {
    const renamedChat = { id: 'c1', projectId: 'p1', title: 'New title' };
    const db = makeDb(renamedChat);
    const events: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker(), undefined, (e) => events.push(e));

    manager.renameChat('c1', 'New title');

    const updated = events.find((e) => e.type === 'chat.updated');
    expect(updated).toBeDefined();
    expect(updated).toMatchObject({ type: 'chat.updated', chat: renamedChat });
  });

  it('emits nothing when the chat does not exist', () => {
    const db = makeDb(null);
    const events: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker(), undefined, (e) => events.push(e));

    manager.renameChat('missing', 'New title');

    expect(events.find((e) => e.type === 'chat.updated')).toBeUndefined();
  });
});
