import { describe, it, expect, vi } from 'vitest';
import { BackgroundTaskTracker } from '../background-tasks/tracker.js';

async function makeManager(onEvent?: (e: unknown) => void) {
  const { ChatManager } = await import('../chat/chat-manager.js');
  const db: any = {
    chats: { get: vi.fn(), list: vi.fn(), update: vi.fn(), listAll: vi.fn().mockReturnValue([]) },
    projects: { get: vi.fn() },
    settings: { get: vi.fn() },
  };
  const adapters: any = { get: vi.fn(), list: vi.fn().mockReturnValue([]) };
  const mgr = new ChatManager(db, adapters, new BackgroundTaskTracker(), undefined, onEvent ?? (() => {}));
  return mgr as any;
}

describe('clearAllQueuedForChat clears chatQueues (A4)', () => {
  it('empties the daemon chatQueues for the given chat', async () => {
    const mgr = await makeManager();
    const internal = mgr as { chatQueues: Map<string, unknown[]> };
    internal.chatQueues.set('chat-A', [
      { uuid: 'u1', messageId: 'm1', content: 'hello', outgoingContent: 'hello', timestamp: '' },
    ]);
    internal.chatQueues.set('chat-B', [
      { uuid: 'u2', messageId: 'm2', content: 'world', outgoingContent: 'world', timestamp: '' },
    ]);

    mgr.clearAllQueuedForChat('chat-A');

    expect(mgr.getQueuedForChat('chat-A')).toHaveLength(0);
    // chat-B must be unaffected
    expect(mgr.getQueuedForChat('chat-B')).toHaveLength(1);
  });

  it('emits message.queued.cleared when there were queued items', async () => {
    const emitted: unknown[] = [];
    const mgr = await makeManager((e) => emitted.push(e));
    const internal = mgr as { chatQueues: Map<string, unknown[]> };
    internal.chatQueues.set('chat-C', [
      { uuid: 'u3', messageId: 'm3', content: 'hi', outgoingContent: 'hi', timestamp: '' },
    ]);

    mgr.clearAllQueuedForChat('chat-C');

    const clearEvents = emitted.filter((e: any) => e.type === 'message.queued.cleared');
    expect(clearEvents).toHaveLength(1);
    expect((clearEvents[0] as any).chatId).toBe('chat-C');
  });

  it('does NOT emit message.queued.cleared when the queue was already empty', async () => {
    const emitted: unknown[] = [];
    const mgr = await makeManager((e) => emitted.push(e));

    mgr.clearAllQueuedForChat('chat-empty');

    const clearEvents = emitted.filter((e: any) => e.type === 'message.queued.cleared');
    expect(clearEvents).toHaveLength(0);
  });
});
