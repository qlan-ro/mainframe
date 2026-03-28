import { describe, it, expect, vi } from 'vitest';
import { ChatConfigManager, type ConfigManagerDeps } from '../../chat/config-manager.js';
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ActiveChat } from '../../chat/types.js';

vi.mock('../../workspace/index.js', () => ({
  createWorktree: vi.fn(() => ({ worktreePath: '/repo/.worktrees/my-branch', branchName: 'my-branch' })),
  removeWorktree: vi.fn(),
  moveSessionFiles: vi.fn(async () => {}),
  getClaudeProjectDir: vi.fn((p: string) => `/home/.claude/projects/${p.replace(/[^a-zA-Z0-9-]/g, '-')}`),
}));

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    projectId: 'proj-1',
    adapterId: 'claude',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Chat;
}

function makeDeps(active: ActiveChat): ConfigManagerDeps {
  return {
    adapters: { get: vi.fn() } as any,
    db: {
      chats: { update: vi.fn() },
      projects: { get: vi.fn(() => ({ id: 'proj-1', path: '/repo' })) },
      settings: { get: vi.fn(() => '.worktrees') },
    } as any,
    startingChats: new Map(),
    getActiveChat: vi.fn(() => active),
    startChat: vi.fn(async () => {}),
    stopChat: vi.fn(async () => {}),
    emitEvent: vi.fn(),
  };
}

describe('mid-session enableWorktree', () => {
  it('stops session, moves files, creates worktree, and restarts', async () => {
    const chat = makeChat({ claudeSessionId: 'sess-1' });
    const active: ActiveChat = { chat, session: { isSpawned: true, kill: vi.fn() } as any };
    const deps = makeDeps(active);

    const manager = new ChatConfigManager(deps);
    await manager.enableWorktree('chat-1', 'main', 'my-branch');

    expect(deps.stopChat).toHaveBeenCalledWith('chat-1');

    const { moveSessionFiles } = await import('../../workspace/index.js');
    expect(moveSessionFiles).toHaveBeenCalledWith(
      'sess-1',
      expect.stringContaining('-repo'),
      expect.stringContaining('worktrees'),
    );

    expect(deps.db.chats.update).toHaveBeenCalledWith('chat-1', {
      worktreePath: '/repo/.worktrees/my-branch',
      branchName: 'my-branch',
    });

    expect(deps.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('uses pre-session path when no claudeSessionId', async () => {
    const chat = makeChat();
    const active: ActiveChat = { chat, session: null };
    const deps = makeDeps(active);

    const manager = new ChatConfigManager(deps);
    await manager.enableWorktree('chat-1', 'main', 'my-branch');

    expect(deps.stopChat).not.toHaveBeenCalled();
    expect(deps.db.chats.update).toHaveBeenCalledWith('chat-1', {
      worktreePath: '/repo/.worktrees/my-branch',
      branchName: 'my-branch',
    });
  });
});

describe('mid-session attachWorktree', () => {
  it('stops session, moves files, and restarts', async () => {
    const chat = makeChat({ claudeSessionId: 'sess-2' });
    const active: ActiveChat = { chat, session: { isSpawned: true, kill: vi.fn() } as any };
    const deps = makeDeps(active);

    const manager = new ChatConfigManager(deps);
    await manager.attachWorktree('chat-1', '/repo/.worktrees/existing-branch', 'existing-branch');

    expect(deps.stopChat).toHaveBeenCalledWith('chat-1');

    const { moveSessionFiles } = await import('../../workspace/index.js');
    expect(moveSessionFiles).toHaveBeenCalledWith(
      'sess-2',
      expect.stringContaining('-repo'),
      expect.stringContaining('existing-branch'),
    );

    expect(deps.db.chats.update).toHaveBeenCalledWith('chat-1', {
      worktreePath: '/repo/.worktrees/existing-branch',
      branchName: 'existing-branch',
    });

    expect(deps.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('uses pre-session path when no claudeSessionId', async () => {
    const chat = makeChat();
    const active: ActiveChat = { chat, session: null };
    const deps = makeDeps(active);

    const manager = new ChatConfigManager(deps);
    await manager.attachWorktree('chat-1', '/repo/.worktrees/existing-branch', 'existing-branch');

    expect(deps.stopChat).not.toHaveBeenCalled();
    expect(deps.db.chats.update).toHaveBeenCalledWith('chat-1', {
      worktreePath: '/repo/.worktrees/existing-branch',
      branchName: 'existing-branch',
    });
  });
});
