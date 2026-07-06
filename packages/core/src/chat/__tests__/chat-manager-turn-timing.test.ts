import { describe, it, expect, vi } from 'vitest';
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

function seed(mgr: any) {
  const active: { chat: any; session: any; turnStartedAt?: number } = {
    chat: { id: 'c1', processState: 'idle', title: 't' },
    session: {
      isSpawned: true,
      supportsReplayAck: false,
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
  mgr.activeChats.set('c1', active);
  mgr.lifecycle = { waitForInterrupt: vi.fn().mockResolvedValue(undefined), doGenerateTitle: vi.fn() };
  return active;
}

describe('ChatManager — turn timing', () => {
  it('stamps turnStartedAt on the active chat right before dispatching to the CLI', async () => {
    const mgr = await makeManager(() => {});
    const active = seed(mgr);

    expect(active.turnStartedAt).toBeUndefined();

    const before = Date.now();
    await mgr.sendMessage('c1', 'hello');
    const after = Date.now();

    expect(typeof active.turnStartedAt).toBe('number');
    expect(active.turnStartedAt).toBeGreaterThanOrEqual(before);
    expect(active.turnStartedAt).toBeLessThanOrEqual(after);
  });
});
