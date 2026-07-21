import { describe, it, expect, vi } from 'vitest';
import type { DatabaseManager } from '../../db/index.js';
import type { AdapterRegistry } from '../../adapters/index.js';
import { ChatManager } from '../chat-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';

// The SQL behavior (which rows flip to idle, the affected count) is covered by
// the real-SQLite ChatsRepository.resetWorkingToIdle test in db/__tests__/chats.test.ts.
describe('ChatManager.recoverStaleWorkingState', () => {
  it('delegates the bulk reset to ChatsRepository.resetWorkingToIdle', () => {
    const resetWorkingToIdle = vi.fn().mockReturnValue(2);
    const db = {
      chats: { resetWorkingToIdle, list: vi.fn().mockReturnValue([]) },
      projects: { list: vi.fn() },
      settings: { get: vi.fn(), getByCategory: vi.fn(), set: vi.fn(), delete: vi.fn() },
    } as unknown as DatabaseManager;
    const adapters = { get: vi.fn(), list: vi.fn(), all: vi.fn().mockReturnValue([]) } as unknown as AdapterRegistry;
    const manager = new ChatManager(db, adapters, new BackgroundTaskTracker());

    manager.recoverStaleWorkingState();

    expect(resetWorkingToIdle).toHaveBeenCalledTimes(1);
  });
});
