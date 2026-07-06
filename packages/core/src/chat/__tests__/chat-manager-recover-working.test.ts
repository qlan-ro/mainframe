import { describe, it, expect, vi } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../../db/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import { ChatManager } from '../chat-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';

/**
 * Builds a minimal stateful mock DB whose chats.update() writes back into the
 * in-memory store so chats.get() and chats.listAll() reflect post-mutation state.
 * Only the fields exercised by recoverStaleWorkingState are modelled.
 */
function makeStatefulDb(initial: Array<Partial<Chat> & { id: string }>): DatabaseManager {
  const store = new Map<string, Partial<Chat> & { id: string }>(initial.map((c) => [c.id, { ...c }]));

  return {
    chats: {
      listAll: () => [...store.values()] as Chat[],
      get: (id: string) => (store.get(id) ?? null) as Chat | null,
      update: (_id: string, partial: Partial<Chat>) => {
        const existing = store.get(_id);
        if (existing) store.set(_id, { ...existing, ...partial });
      },
      resetWorkingToIdle: () => {
        let count = 0;
        for (const [id, chat] of store) {
          if (chat.processState === 'working') {
            store.set(id, { ...chat, processState: 'idle' });
            count++;
          }
        }
        return count;
      },
      list: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      archive: vi.fn(),
      listFiltered: vi.fn().mockReturnValue([]),
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

describe('ChatManager.recoverStaleWorkingState', () => {
  it('resets a working chat to idle', () => {
    const db = makeStatefulDb([
      { id: 'c-working', projectId: 'p1', processState: 'working' },
      { id: 'c-idle', projectId: 'p1', processState: 'idle' },
      { id: 'c-null', projectId: 'p1', processState: null as unknown as undefined },
    ]);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    manager.recoverStaleWorkingState();

    expect(db.chats.get('c-working')?.processState).toBe('idle');
  });

  it('leaves an already-idle chat unchanged', () => {
    const db = makeStatefulDb([
      { id: 'c-working', projectId: 'p1', processState: 'working' },
      { id: 'c-idle', projectId: 'p1', processState: 'idle' },
      { id: 'c-null', projectId: 'p1', processState: null as unknown as undefined },
    ]);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    manager.recoverStaleWorkingState();

    expect(db.chats.get('c-idle')?.processState).toBe('idle');
  });

  it('does not touch a chat whose processState is null', () => {
    const db = makeStatefulDb([
      { id: 'c-working', projectId: 'p1', processState: 'working' },
      { id: 'c-idle', projectId: 'p1', processState: 'idle' },
      { id: 'c-null', projectId: 'p1', processState: null as unknown as undefined },
    ]);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    manager.recoverStaleWorkingState();

    expect(db.chats.get('c-null')?.processState).toBeNull();
  });

  it('is a no-op when no chats are stored', () => {
    const db = makeStatefulDb([]);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    expect(() => manager.recoverStaleWorkingState()).not.toThrow();
  });

  it('resets every working chat when multiple are stale', () => {
    const db = makeStatefulDb([
      { id: 'w1', projectId: 'p1', processState: 'working' },
      { id: 'w2', projectId: 'p1', processState: 'working' },
      { id: 'ok', projectId: 'p1', processState: 'idle' },
    ]);
    const manager = new ChatManager(db, makeAdapters(), new BackgroundTaskTracker());

    manager.recoverStaleWorkingState();

    expect(db.chats.get('w1')?.processState).toBe('idle');
    expect(db.chats.get('w2')?.processState).toBe('idle');
    expect(db.chats.get('ok')?.processState).toBe('idle');
  });
});
