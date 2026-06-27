import { describe, it, expect, vi } from 'vitest';
import { BackgroundTaskTracker } from '../background-tasks/tracker.js';

async function makeManager() {
  const { ChatManager } = await import('../chat/chat-manager.js');
  const db: any = {
    chats: { get: vi.fn(), list: vi.fn(), update: vi.fn(), listAll: vi.fn().mockReturnValue([]) },
    projects: { get: vi.fn() },
    settings: { get: vi.fn() },
  };
  const adapters: any = { get: vi.fn(), list: vi.fn().mockReturnValue([]) };
  const mgr = new ChatManager(db, adapters, new BackgroundTaskTracker());
  return mgr as any;
}

describe('daemon holds the queue (A1)', () => {
  it('a mid-run send is held in chatQueues and NOT written to the CLI', async () => {
    const mgr = await makeManager();
    const emit = vi.fn();
    mgr.emitEvent = emit; // ChatManager.emitEvent is the event sink used by sendMessage
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    // Wire a fake active chat already 'working' with a replay-ack session.
    mgr.activeChats = new Map([
      [
        'c1',
        {
          chat: { id: 'c1', processState: 'working', title: 't' },
          session: { id: 's1', adapterId: 'claude', supportsReplayAck: true, sendMessage, isSpawned: true },
        },
      ],
    ]);
    // Make startSession-equivalent resolve to the active chat (read how sendMessage
    // obtains `postStart`; in tests, stub the resolver it uses — see Step 3 note).
    await mgr.sendMessage('c1', 'queued text');

    expect(sendMessage).not.toHaveBeenCalled();
    const queued = mgr.getQueuedForChat('c1');
    expect(queued).toHaveLength(1);
    expect(queued[0].content).toBe('queued text');
    expect(emit.mock.calls.some((c: any[]) => c[0].type === 'message.queued')).toBe(true);
  });
});
