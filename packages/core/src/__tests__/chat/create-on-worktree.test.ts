import { describe, it, expect, vi } from 'vitest';
import { ChatLifecycleManager } from '../../chat/lifecycle-manager.js';
import type { LifecycleManagerDeps } from '../../chat/lifecycle-manager.js';
import type { Chat } from '@qlan-ro/mainframe-types';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-new',
    projectId: 'proj-1',
    adapterId: 'claude',
    model: 'claude-sonnet-4-5',
    permissionMode: 'default',
    status: 'active',
    processState: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: undefined,
    claudeSessionId: undefined,
    worktreePath: undefined,
    branchName: undefined,
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LifecycleManagerDeps> = {}): LifecycleManagerDeps {
  const createdChat = makeChat();
  return {
    db: {
      chats: {
        get: vi.fn(() => createdChat),
        create: vi.fn(() => createdChat),
        update: vi.fn(),
      },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    adapters: { get: vi.fn(), all: vi.fn().mockReturnValue([]) } as any,
    activeChats: new Map(),
    messages: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as any,
    permissions: {
      clear: vi.fn(),
      hasPending: vi.fn(),
      markInterrupted: vi.fn(),
      restorePendingPermission: vi.fn(),
    } as any,
    emitEvent: vi.fn(),
    buildSink: vi.fn(),
    ...overrides,
  };
}

describe('ChatLifecycleManager.createChat — worktree attachment', () => {
  it('persists worktreePath and branchName on create when provided', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);

    const chat = await lifecycle.createChat(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );

    expect(deps.db.chats.create).toHaveBeenCalledWith('proj-1', 'claude', 'claude-sonnet-4-5', 'default');
    expect(deps.db.chats.update).toHaveBeenCalledWith(chat.id, {
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: 'feat-x',
    });
    expect(chat.worktreePath).toBe('/projects/my-repo/.worktrees/feat-x');
    expect(chat.branchName).toBe('feat-x');
  });

  it('does not update worktree fields when not provided (back-compat)', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);

    await lifecycle.createChat('proj-1', 'claude', 'claude-sonnet-4-5', 'default');

    expect(deps.db.chats.update).not.toHaveBeenCalled();
  });

  it('emits chat.created with worktree fields populated', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);

    await lifecycle.createChat(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );

    expect(deps.emitEvent).toHaveBeenCalledWith({
      type: 'chat.created',
      chat: expect.objectContaining({
        worktreePath: '/projects/my-repo/.worktrees/feat-x',
        branchName: 'feat-x',
      }),
    });
  });
});

describe('ChatLifecycleManager.createChatWithDefaults — worktree attachment', () => {
  it('forwards worktreePath and branchName to createChat', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);
    const spy = vi.spyOn(lifecycle, 'createChat');

    await lifecycle.createChatWithDefaults(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );

    expect(spy).toHaveBeenCalledWith(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );
  });
});
