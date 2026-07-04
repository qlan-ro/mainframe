import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

async function makeManager(onEvent: (e: DaemonEvent) => void) {
  const { ChatManager } = await import('../chat-manager.js');
  const { BackgroundTaskTracker } = await import('../../background-tasks/tracker.js');
  const db: any = {
    chats: { get: vi.fn(), list: vi.fn(), update: vi.fn(), listAll: vi.fn().mockReturnValue([]) },
    projects: { get: vi.fn() },
    settings: { get: vi.fn() },
  };
  const adapters: any = { get: vi.fn(), list: vi.fn().mockReturnValue([]) };
  return new ChatManager(db, adapters, new BackgroundTaskTracker(), undefined, onEvent) as any;
}

function seed(mgr: any, cancelQueuedMessage: any) {
  const active = {
    chat: { id: 'c1', processState: 'working', title: 't' },
    session: {
      isSpawned: true,
      supportsReplayAck: true,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelQueuedMessage,
    },
  };
  mgr.activeChats.set('c1', active);
  mgr.lifecycle = { waitForInterrupt: vi.fn().mockResolvedValue(undefined), doGenerateTitle: vi.fn() };
  return active;
}

describe('ChatManager — CLI-owned queue (origin/main parity)', () => {
  let events: DaemonEvent[];
  beforeEach(() => {
    events = [];
  });

  it('writes to the CLI immediately with a uuid and records a queuedRef while working', async () => {
    const mgr = await makeManager((e) => events.push(e));
    const active = seed(mgr, vi.fn().mockResolvedValue(true));
    await mgr.sendMessage('c1', 'hello while busy');
    expect(active.session.sendMessage).toHaveBeenCalledTimes(1);
    const [, , uuid] = active.session.sendMessage.mock.calls[0];
    expect(typeof uuid).toBe('string');
    expect(mgr.getQueuedForChat('c1')).toHaveLength(1);
    expect(events.some((e) => e.type === 'message.queued')).toBe(true);
  });

  it('handleQueuedProcessed deletes the ref', async () => {
    const mgr = await makeManager((e) => events.push(e));
    seed(mgr, vi.fn().mockResolvedValue(true));
    await mgr.sendMessage('c1', 'hi');
    const uuid = mgr.getQueuedForChat('c1')[0].uuid;
    mgr.handleQueuedProcessed('c1', uuid);
    expect(mgr.getQueuedForChat('c1')).toHaveLength(0);
  });

  it('cancel success removes the bubble and emits cancelled', async () => {
    const mgr = await makeManager((e) => events.push(e));
    const cancelQueuedMessage = vi.fn().mockResolvedValue(true);
    seed(mgr, cancelQueuedMessage);
    await mgr.sendMessage('c1', 'to cancel');
    const ref = mgr.getQueuedForChat('c1')[0];
    await mgr.cancelQueuedMessage('c1', ref.messageId);
    expect(cancelQueuedMessage).toHaveBeenCalledWith(ref.uuid);
    expect(mgr.getQueuedForChat('c1')).toHaveLength(0);
    expect(events.some((e) => e.type === 'message.queued.cancelled' && (e as any).uuid === ref.uuid)).toBe(true);
  });
});
