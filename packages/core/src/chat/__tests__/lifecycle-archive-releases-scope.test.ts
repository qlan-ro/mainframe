import { describe, it, expect, vi } from 'vitest';
import { ChatLifecycleManager, isLastActiveChatForScope } from '../lifecycle-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';

vi.mock('../../workspace/index.js', () => ({ removeWorktree: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../background-tasks/kill.js', () => ({
  killTasksForChat: vi.fn().mockResolvedValue({ killed: [], failed: [], swept: [] }),
}));

const chat = (over: Record<string, unknown>) => ({
  id: 'x',
  projectId: 'p1',
  status: 'active',
  worktreePath: undefined,
  branchName: undefined,
  ...over,
});

describe('isLastActiveChatForScope', () => {
  it('is false when a non-archived sibling shares the worktree scope', () => {
    const chats = [chat({ id: 'c1', worktreePath: '/wt/x' }), chat({ id: 'c2', worktreePath: '/wt/x' })] as any;
    expect(isLastActiveChatForScope(chats, '/proj', '/wt/x', 'c1')).toBe(false);
  });

  it('is false when a non-archived sibling shares the project-root scope (no worktrees)', () => {
    const chats = [chat({ id: 'c1' }), chat({ id: 'c2' })] as any;
    expect(isLastActiveChatForScope(chats, '/proj', '/proj', 'c1')).toBe(false);
  });

  it('is true for a unique worktree scope', () => {
    const chats = [chat({ id: 'c1', worktreePath: '/wt/x' }), chat({ id: 'c2', worktreePath: '/wt/y' })] as any;
    expect(isLastActiveChatForScope(chats, '/proj', '/wt/x', 'c1')).toBe(true);
  });

  it('ignores archived siblings on the same scope', () => {
    const chats = [
      chat({ id: 'c1', worktreePath: '/wt/x' }),
      chat({ id: 'c2', worktreePath: '/wt/x', status: 'archived' }),
    ] as any;
    expect(isLastActiveChatForScope(chats, '/proj', '/wt/x', 'c1')).toBe(true);
  });

  it('excludes the chat being archived from the count', () => {
    const chats = [chat({ id: 'c1', worktreePath: '/wt/x' })] as any;
    expect(isLastActiveChatForScope(chats, '/proj', '/wt/x', 'c1')).toBe(true);
  });
});

function makeLifecycle(opts: {
  chat: Record<string, unknown>;
  siblings?: Record<string, unknown>[];
  stop: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}) {
  const c = chat(opts.chat);
  const all = [c, ...(opts.siblings ?? [])];
  const activeChats = new Map<string, any>();
  return new ChatLifecycleManager({
    db: {
      chats: { get: vi.fn(() => c), list: vi.fn(() => all), update: vi.fn() } as any,
      projects: { get: vi.fn(() => ({ path: '/proj' })) } as any,
    } as any,
    adapters: {} as any,
    activeChats,
    messages: { delete: vi.fn() } as any,
    permissions: { clear: vi.fn() } as any,
    emitEvent: opts.emit,
    buildSink: vi.fn(),
    tracker: new BackgroundTaskTracker(),
    stopLaunchProcesses: opts.stop,
  } as any);
}

describe('archiveChat — scope release', () => {
  it('last user: stops launches with effectivePath and emits launch.scopeReleased', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const lifecycle = makeLifecycle({ chat: { id: 'c1', worktreePath: '/wt/x', branchName: 'feat/x' }, stop, emit });
    await lifecycle.archiveChat('c1', false); // keep-worktree
    expect(stop).toHaveBeenCalledWith('p1', '/wt/x');
    expect(emit).toHaveBeenCalledWith({ type: 'launch.scopeReleased', projectId: 'p1', effectivePath: '/wt/x' });
  });

  it('shared scope: a non-archived sibling keeps the scope alive (no stop, no release event)', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const lifecycle = makeLifecycle({
      chat: { id: 'c1', worktreePath: '/wt/x', branchName: 'feat/x' },
      siblings: [chat({ id: 'c2', worktreePath: '/wt/x' })],
      stop,
      emit,
    });
    await lifecycle.archiveChat('c1', false);
    expect(stop).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'launch.scopeReleased' }));
  });

  it('no-worktree last user: releases the project-root scope', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const lifecycle = makeLifecycle({ chat: { id: 'c1' }, stop, emit });
    await lifecycle.archiveChat('c1', false);
    expect(stop).toHaveBeenCalledWith('p1', '/proj');
    expect(emit).toHaveBeenCalledWith({ type: 'launch.scopeReleased', projectId: 'p1', effectivePath: '/proj' });
  });
});
