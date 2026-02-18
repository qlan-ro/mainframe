import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatManager } from '../chat/index.js';

describe('ChatManager.isChatRunning', () => {
  let manager: ChatManager;

  beforeEach(() => {
    const mockDb = {
      chats: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    } as any;
    const mockAdapters = { get: vi.fn() } as any;
    manager = new ChatManager(mockDb, mockAdapters);
  });

  it('returns false for non-existent chat', () => {
    expect(manager.isChatRunning('nonexistent')).toBe(false);
  });

  it('returns false for chat with null process', () => {
    (manager as any).activeChats.set('test-1', { chat: {} as any, process: null });
    expect(manager.isChatRunning('test-1')).toBe(false);
  });

  it('returns true for chat with active process', () => {
    (manager as any).activeChats.set('test-2', {
      chat: {} as any,
      process: { id: 'proc-1', adapterId: 'claude' },
    });
    expect(manager.isChatRunning('test-2')).toBe(true);
  });
});
