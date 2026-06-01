import { describe, it, expect, vi } from 'vitest';
import { ChatManager } from '../chat-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';
import * as killMod from '../../background-tasks/kill.js';

describe('ChatManager.removeProject', () => {
  it('calls killTasksForChat with worktreePath BEFORE session.kill, for each chat in the project', async () => {
    const order: string[] = [];
    const killSpy = vi.spyOn(killMod, 'killTasksForChat').mockImplementation(async (args) => {
      order.push(`kill:${args.chatId}:${args.worktreePath ?? 'no-wt'}`);
      return { killed: [], failed: [], swept: [] };
    });
    const sess = (id: string) => ({
      kill: vi.fn(async () => {
        order.push(`sess.kill:${id}`);
      }),
    });
    const session1 = sess('c1');
    const session2 = sess('c2');

    const chats = [
      { id: 'c1', projectId: 'p1', worktreePath: '/wt/c1' },
      { id: 'c2', projectId: 'p1', worktreePath: null },
    ];
    const db: any = {
      chats: { list: () => chats },
      projects: { remove: vi.fn() },
    };
    const adapters: any = {};
    const tracker = new BackgroundTaskTracker();
    const mgr = new ChatManager(db, adapters, tracker);
    // @ts-expect-error — reach into private state for the test
    mgr['activeChats'].set('c1', { chat: chats[0], session: session1 });
    // @ts-expect-error — reach into private state for the test
    mgr['activeChats'].set('c2', { chat: chats[1], session: session2 });

    await mgr.removeProject('p1');

    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'c1', worktreePath: '/wt/c1' }));
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'c2', worktreePath: undefined }));
    expect(order.indexOf('kill:c1:/wt/c1')).toBeLessThan(order.indexOf('sess.kill:c1'));
    expect(order.indexOf('kill:c2:no-wt')).toBeLessThan(order.indexOf('sess.kill:c2'));
  });
});
