import { describe, it, expect, vi } from 'vitest';
import { BackgroundTaskTracker } from '../background-tasks/tracker.js';

async function makeManager() {
  const { ChatManager } = await import('../chat/chat-manager.js');
  const db: any = {
    chats: { get: vi.fn(), update: vi.fn(), listAll: vi.fn().mockReturnValue([]) },
    projects: { get: vi.fn() },
    settings: { get: vi.fn() },
  };
  const adapters: any = { get: vi.fn(), list: vi.fn().mockReturnValue([]) };
  return new ChatManager(db, adapters, new BackgroundTaskTracker()) as any;
}

describe('daemon queue cancel/edit (A2)', () => {
  it('cancel removes the held item and emits cancelled, with NO session call', async () => {
    const mgr = await makeManager();
    const emit = vi.fn();
    mgr.emitEvent = emit;
    const removeById = vi.fn();
    mgr.messages = { removeById, get: vi.fn().mockReturnValue([]) };
    mgr.eventHandler = { emitDisplay: vi.fn() };
    const cancelQ = vi.fn();
    mgr.activeChats = new Map([['c1', { chat: { id: 'c1' }, session: { cancelQueuedMessage: cancelQ } }]]);
    mgr.chatQueues = new Map([
      ['c1', [{ messageId: 'm1', uuid: 'u1', content: 'x', outgoingContent: 'x', timestamp: '' }]],
    ]);

    await mgr.cancelQueuedMessage('c1', 'm1');

    expect(cancelQ).not.toHaveBeenCalled();
    expect(mgr.getQueuedForChat('c1')).toHaveLength(0);
    expect(removeById).toHaveBeenCalledWith('c1', 'm1');
    expect(emit.mock.calls.some((c: any[]) => c[0].type === 'message.queued.cancelled' && c[0].uuid === 'u1')).toBe(
      true,
    );
    expect(emit.mock.calls.some((c: any[]) => c[0].type === 'message.queued.cancel_failed')).toBe(false);
  });

  it('edit updates the held content and emits a snapshot, with NO re-send', async () => {
    const mgr = await makeManager();
    const emit = vi.fn();
    mgr.emitEvent = emit;
    const sendMessage = vi.fn();
    mgr.messages = {
      removeById: vi.fn(),
      get: vi
        .fn()
        .mockReturnValue([
          { id: 'm1', content: [{ type: 'text', text: 'old' }], metadata: { queued: true, uuid: 'u1' } },
        ]),
    };
    mgr.eventHandler = { emitDisplay: vi.fn() };
    mgr.activeChats = new Map([['c1', { chat: { id: 'c1' }, session: { sendMessage } }]]);
    mgr.chatQueues = new Map([
      ['c1', [{ messageId: 'm1', uuid: 'u1', content: 'old', outgoingContent: 'old', timestamp: '' }]],
    ]);

    await mgr.editQueuedMessage('c1', 'm1', 'new');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(mgr.getQueuedForChat('c1')[0].content).toBe('new');
    expect(emit.mock.calls.some((c: any[]) => c[0].type === 'message.queued.snapshot')).toBe(true);
  });
});
