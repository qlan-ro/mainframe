import { describe, it, expect, vi } from 'vitest';
import { ChatLifecycleManager } from '../lifecycle-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';
import * as killMod from '../../background-tasks/kill.js';

vi.mock('../../workspace/index.js', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

describe('ChatLifecycleManager.archiveChat', () => {
  it('calls killTasksForChat with worktreePath BEFORE session.kill', async () => {
    const events: string[] = [];
    const killSpy = vi.spyOn(killMod, 'killTasksForChat').mockImplementation(async (args) => {
      events.push(`kill:${args.worktreePath ?? 'no-wt'}`);
      return { killed: [], failed: [], swept: [] };
    });
    const session = {
      kill: vi.fn(async () => {
        events.push('session.kill');
      }),
    };

    const tracker = new BackgroundTaskTracker();
    const chat = { id: 'c1', projectId: 'p1', worktreePath: '/wt/x', branchName: 'feat/x' };
    const activeChats = new Map<string, any>();
    activeChats.set('c1', { chat, session });

    const lifecycle = new ChatLifecycleManager({
      db: {
        chats: { update: vi.fn(), get: vi.fn(() => chat) } as any,
        projects: { get: vi.fn(() => ({ path: '/proj/x' })) } as any,
      } as any,
      adapters: {} as any,
      activeChats,
      messages: { delete: vi.fn() } as any,
      permissions: { clear: vi.fn() } as any,
      emitEvent: vi.fn(),
      buildSink: vi.fn(),
      tracker,
      stopLaunchProcesses: vi.fn().mockResolvedValue(undefined),
    } as any);

    await lifecycle.archiveChat('c1', true);

    const killIdx = events.indexOf('kill:/wt/x');
    const sessIdx = events.indexOf('session.kill');
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(sessIdx).toBeGreaterThan(killIdx);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'c1', worktreePath: '/wt/x' }));
  });
});
