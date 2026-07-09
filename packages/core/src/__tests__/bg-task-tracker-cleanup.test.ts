import { BackgroundTaskTracker } from '../background-tasks/tracker.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { ChatManager } from '../chat/chat-manager.js';

function makeDb(chatRecord?: { id: string }) {
  return {
    chats: {
      list: vi.fn().mockReturnValue(chatRecord ? [chatRecord] : []),
      get: vi.fn().mockReturnValue(chatRecord ?? null),
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

function seedActiveChat(manager: ChatManager, chatId: string, tracker: BackgroundTaskTracker) {
  // Plant a task in the tracker so we can confirm it's cleaned up
  tracker.start(
    chatId,
    { id: 'task-1', kind: 'bash', toolName: 'Bash', toolUseId: 'tu-1', command: 'sleep 1', description: '' },
    '/tmp/out',
  );
  // Inject a minimal active chat
  (manager as any).activeChats.set(chatId, {
    chat: { id: chatId, adapterId: 'claude', projectId: 'proj-1', processState: 'idle' },
    session: null,
  });
}

describe('bg-task tracker cleanup on chat lifecycle', () => {
  let tracker: BackgroundTaskTracker;
  let manager: ChatManager;

  beforeEach(() => {
    tracker = new BackgroundTaskTracker();
  });

  describe('endChat', () => {
    it('removes the chat entry from the tracker after ending', async () => {
      const chatId = 'chat-end-1';
      const db = makeDb({ id: chatId });
      manager = new ChatManager(db, makeAdapters(), tracker);
      seedActiveChat(manager, chatId, tracker);

      // confirm task is present before
      expect(tracker.list(chatId)).toHaveLength(1);

      await manager.endChat(chatId);

      // tracker should no longer hold any tasks for this chat
      expect(tracker.list(chatId)).toHaveLength(0);
      expect(tracker.get(chatId, 'task-1')).toBeNull();
    });
  });

  describe('removeProject', () => {
    it('removes tracker entries for all chats when a project is deleted', async () => {
      const chatId = 'chat-proj-1';
      const db = makeDb({ id: chatId });
      manager = new ChatManager(db, makeAdapters(), tracker);
      seedActiveChat(manager, chatId, tracker);

      expect(tracker.list(chatId)).toHaveLength(1);

      await manager.removeProject('proj-1');

      expect(tracker.list(chatId)).toHaveLength(0);
    });
  });

  describe('archiveChat', () => {
    it('removes tracker entries for the chat after archiving', async () => {
      const chatId = 'chat-archive-1';
      const db = makeDb({ id: chatId });
      manager = new ChatManager(db, makeAdapters(), tracker);
      seedActiveChat(manager, chatId, tracker);

      expect(tracker.list(chatId)).toHaveLength(1);

      await manager.archiveChat(chatId);

      expect(tracker.list(chatId)).toHaveLength(0);
    });
  });
});
