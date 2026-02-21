import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { ChatManager } from '../chat/chat-manager.js';

function makeDb(chats: { id: string }[] = []) {
  return {
    chats: {
      list: vi.fn().mockReturnValue(chats),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      addMention: vi.fn(),
      getModifiedFilesList: vi.fn(),
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

function makeAdapters(kill?: ReturnType<typeof vi.fn>): AdapterRegistry {
  // EventHandler.setup() calls adapters.get('claude').on(...) — return an
  // EventEmitter-compatible stub so construction doesn't throw.
  const stub = new EventEmitter() as EventEmitter & { kill?: typeof kill };
  if (kill) stub.kill = kill;
  const get = vi.fn().mockReturnValue(kill ? stub : undefined);
  return { get, list: vi.fn() } as unknown as AdapterRegistry;
}

describe('ChatManager.removeProject', () => {
  it('calls removeWithChats when no chats are active', async () => {
    const db = makeDb([]);
    const manager = new ChatManager(db, makeAdapters());

    await manager.removeProject('proj-1');

    expect(db.projects.removeWithChats).toHaveBeenCalledWith('proj-1');
  });

  it('kills active process before deleting', async () => {
    const db = makeDb([{ id: 'chat-1' }]);
    const kill = vi.fn().mockResolvedValue(undefined);
    const adapters = makeAdapters(kill);

    const manager = new ChatManager(db, adapters);

    // Inject a fake active chat with a running process
    const fakeProcess = { id: 'proc-1' } as any;
    (manager as any).activeChats.set('chat-1', {
      chat: { id: 'chat-1', adapterId: 'claude', projectId: 'proj-1' },
      process: fakeProcess,
    });
    (manager as any).processToChat.set('proc-1', 'chat-1');

    await manager.removeProject('proj-1');

    expect(kill).toHaveBeenCalledWith(fakeProcess);
    expect((manager as any).processToChat.has('proc-1')).toBe(false);
    expect((manager as any).activeChats.has('chat-1')).toBe(false);
    expect(db.projects.removeWithChats).toHaveBeenCalledWith('proj-1');
  });
});
