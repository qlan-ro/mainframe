import { BackgroundTaskTracker } from '../background-tasks/tracker.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { ChatManager } from '../chat/chat-manager.js';
import type { ActiveChat } from '../chat/types.js';

// Merged from chat-manager-is-running/remove-project/rename/sync-fields/
// unarchive.test.ts + bg-task-tracker-cleanup.test.ts — all six exercised the
// same ChatManager-over-mock-db shape with near-identical fixtures.

function makeDb(chat: Record<string, unknown> | null = null): DatabaseManager {
  return {
    chats: {
      list: vi.fn().mockReturnValue(chat ? [chat] : []),
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
  return {
    get: vi.fn().mockReturnValue(undefined),
    list: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  } as unknown as AdapterRegistry;
}

describe('ChatManager.isChatRunning', () => {
  let manager: ChatManager;

  beforeEach(() => {
    manager = new ChatManager(makeDb(), makeAdapters(), new BackgroundTaskTracker());
  });

  it('returns false for non-existent chat', () => {
    expect(manager.isChatRunning('nonexistent')).toBe(false);
  });

  it('returns false for chat with null session', () => {
    (manager as any).activeChats.set('test-1', { chat: {} as any, session: null });
    expect(manager.isChatRunning('test-1')).toBe(false);
  });

  it('returns true for chat with active process', () => {
    (manager as any).activeChats.set('test-2', {
      chat: {} as any,
      session: { isSpawned: true },
    });
    expect(manager.isChatRunning('test-2')).toBe(true);
  });
});

describe('ChatManager.removeProject', () => {
  it('calls remove when no chats are active', async () => {
    const db = makeDb();
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    await manager.removeProject('proj-1');

    expect(db.projects.remove).toHaveBeenCalledWith('proj-1');
  });

  it('kills active process before deleting', async () => {
    const db = makeDb({ id: 'chat-1' });
    const adapters = makeAdapters();
    const manager = new ChatManager(db, adapters, new BackgroundTaskTracker());

    const killSpy = vi.fn().mockResolvedValue(undefined);
    const removeAllListenersSpy = vi.fn();
    const fakeSession = {
      isSpawned: true,
      kill: killSpy,
      removeAllListeners: removeAllListenersSpy,
    } as any;
    (manager as any).activeChats.set('chat-1', {
      chat: { id: 'chat-1', adapterId: 'claude', projectId: 'proj-1' },
      session: fakeSession,
    });

    await manager.removeProject('proj-1');

    expect(killSpy).toHaveBeenCalled();
    expect((manager as any).activeChats.has('chat-1')).toBe(false);
    expect(db.projects.remove).toHaveBeenCalledWith('proj-1');
  });
});

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

describe('ChatManager.syncChatFields', () => {
  it('updates cached active chat fields so a later chat.updated emission is not stale', () => {
    const cached = { id: 'c1', projectId: 'p1', status: 'active', pinned: false };
    const db = makeDb(cached);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());
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
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    expect(() => manager.syncChatFields('c1', { pinned: true })).not.toThrow();
  });

  it('merges partial updates without dropping unrelated fields', () => {
    const cached = { id: 'c1', projectId: 'p1', status: 'active', pinned: false, effort: 'low', title: 'keep me' };
    const db = makeDb(cached);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());
    const activeChats = (manager as unknown as { activeChats: Map<string, ActiveChat> }).activeChats;
    activeChats.set('c1', { chat: { ...cached } } as unknown as ActiveChat);

    manager.syncChatFields('c1', { effort: 'high' });

    const cachedNow = activeChats.get('c1')?.chat as unknown as Record<string, unknown>;
    expect(cachedNow.effort).toBe('high');
    expect(cachedNow.title).toBe('keep me');
    expect(cachedNow.pinned).toBe(false);
  });
});

describe('ChatManager.emitChatUpdated', () => {
  it('emits a chat.updated event whose chat carries the persisted effort value', () => {
    const persistedChat = { id: 'c1', projectId: 'p1', status: 'active', effort: 'high' };
    const db = makeDb(persistedChat);
    const emitted: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker(), undefined, (e) => emitted.push(e));

    manager.emitChatUpdated('c1');

    expect(emitted).toHaveLength(1);
    const event = emitted[0];
    expect(event.type).toBe('chat.updated');
    if (event.type === 'chat.updated') {
      expect(event.chat.effort).toBe('high');
    }
  });

  it('emits nothing when the chat does not exist', () => {
    const db = makeDb(null);
    const emitted: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker(), undefined, (e) => emitted.push(e));

    manager.emitChatUpdated('nonexistent');

    expect(emitted).toHaveLength(0);
  });
});

describe('ChatManager.unarchiveChat', () => {
  it('flips the chat status to active in the DB', () => {
    const restoredChat = { id: 'c1', projectId: 'p1', status: 'active' };
    const db = makeDb(restoredChat);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    manager.unarchiveChat('c1');

    expect(db.chats.update).toHaveBeenCalledWith('c1', { status: 'active' });
  });

  it('emits a chat.updated event so clients learn about the new status', () => {
    const restoredChat = { id: 'c1', projectId: 'p1', status: 'active' };
    const db = makeDb(restoredChat);
    const events: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker(), undefined, (e) => events.push(e));

    manager.unarchiveChat('c1');

    const updated = events.find((e) => e.type === 'chat.updated');
    expect(updated).toBeDefined();
    expect(updated).toMatchObject({ type: 'chat.updated', chat: restoredChat });
  });

  it('returns the refreshed chat', () => {
    const restoredChat = { id: 'c1', projectId: 'p1', status: 'active' };
    const db = makeDb(restoredChat);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    expect(manager.unarchiveChat('c1')).toEqual(restoredChat);
  });

  it('returns null and emits nothing when the chat does not exist', () => {
    const db = makeDb(null);
    const events: DaemonEvent[] = [];
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker(), undefined, (e) => events.push(e));

    expect(manager.unarchiveChat('missing')).toBeNull();
    expect(events.find((e) => e.type === 'chat.updated')).toBeUndefined();
  });
});

describe('bg-task tracker cleanup on chat lifecycle', () => {
  let tracker: BackgroundTaskTracker;

  function seedActiveChat(manager: ChatManager, chatId: string) {
    tracker.start(
      chatId,
      { id: 'task-1', kind: 'bash', toolName: 'Bash', toolUseId: 'tu-1', command: 'sleep 1', description: '' },
      '/tmp/out',
    );
    (manager as any).activeChats.set(chatId, {
      chat: { id: chatId, adapterId: 'claude', projectId: 'proj-1', processState: 'idle' },
      session: null,
    });
  }

  beforeEach(() => {
    tracker = new BackgroundTaskTracker();
  });

  it('endChat removes the chat entry from the tracker after ending', async () => {
    const chatId = 'chat-end-1';
    const manager = new ChatManager(makeDb({ id: chatId }), makeAdapters(), tracker);
    seedActiveChat(manager, chatId);
    expect(tracker.list(chatId)).toHaveLength(1);

    await manager.endChat(chatId);

    expect(tracker.list(chatId)).toHaveLength(0);
    expect(tracker.get(chatId, 'task-1')).toBeNull();
  });

  it('removeProject removes tracker entries for all chats when a project is deleted', async () => {
    const chatId = 'chat-proj-1';
    const manager = new ChatManager(makeDb({ id: chatId }), makeAdapters(), tracker);
    seedActiveChat(manager, chatId);
    expect(tracker.list(chatId)).toHaveLength(1);

    await manager.removeProject('proj-1');

    expect(tracker.list(chatId)).toHaveLength(0);
  });

  it('archiveChat removes tracker entries for the chat after archiving', async () => {
    const chatId = 'chat-archive-1';
    const manager = new ChatManager(makeDb({ id: chatId }), makeAdapters(), tracker);
    seedActiveChat(manager, chatId);
    expect(tracker.list(chatId)).toHaveLength(1);

    await manager.archiveChat(chatId);

    expect(tracker.list(chatId)).toHaveLength(0);
  });
});
