import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatLifecycleManager } from '../../chat/lifecycle-manager.js';
import type { LifecycleManagerDeps } from '../../chat/lifecycle-manager.js';
import type { Chat } from '@qlan-ro/mainframe-types';

function initCleanGitRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fork-wt-test-'));
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function makeDeps(overrides: Partial<LifecycleManagerDeps> = {}): LifecycleManagerDeps {
  return {
    db: {
      chats: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
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

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-source',
    projectId: 'proj-1',
    adapterId: 'claude',
    model: 'claude-3-5-sonnet',
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

describe('ChatLifecycleManager.forkToWorktree', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initCleanGitRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates a new chat and calls enableWorktreeFn when working tree is clean', async () => {
    const sourceChat = makeChat();
    const newChat = makeChat({ id: 'chat-new' });

    const deps = makeDeps();
    deps.activeChats.set('chat-source', { chat: sourceChat, session: null });
    (deps.db.projects.get as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'proj-1', path: repoDir });
    (deps.db.chats.create as ReturnType<typeof vi.fn>).mockReturnValue(newChat);

    const manager = new ChatLifecycleManager(deps);
    const enableWorktreeFn = vi.fn().mockResolvedValue(undefined);

    const result = await manager.forkToWorktree('chat-source', 'main', 'feat/fork', enableWorktreeFn);

    expect(result).toEqual({ chatId: 'chat-new' });
    expect(deps.db.chats.create).toHaveBeenCalledWith(
      sourceChat.projectId,
      sourceChat.adapterId,
      sourceChat.model,
      sourceChat.permissionMode,
    );
    expect(enableWorktreeFn).toHaveBeenCalledWith('chat-new', 'main', 'feat/fork');
    expect(deps.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.created', chat: newChat }));
  });

  it('throws 409 when working tree has uncommitted changes', async () => {
    const sourceChat = makeChat();

    const deps = makeDeps();
    deps.activeChats.set('chat-source', { chat: sourceChat, session: null });
    (deps.db.projects.get as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'proj-1', path: repoDir });

    // Create an untracked file to make the working tree dirty
    writeFileSync(path.join(repoDir, 'dirty.txt'), 'uncommitted');

    const manager = new ChatLifecycleManager(deps);
    const enableWorktreeFn = vi.fn();

    await expect(manager.forkToWorktree('chat-source', 'main', 'feat/fork', enableWorktreeFn)).rejects.toMatchObject({
      message: 'Commit or stash your changes before forking',
      statusCode: 409,
    });

    expect(enableWorktreeFn).not.toHaveBeenCalled();
    expect(deps.db.chats.create).not.toHaveBeenCalled();
  });

  it('throws when source chat is not found in activeChats or DB', async () => {
    const deps = makeDeps();
    // activeChats is empty and db.chats.get returns undefined
    (deps.db.chats.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const manager = new ChatLifecycleManager(deps);
    const enableWorktreeFn = vi.fn();

    await expect(manager.forkToWorktree('nonexistent-chat', 'main', 'feat/fork', enableWorktreeFn)).rejects.toThrow(
      'Chat nonexistent-chat not found',
    );

    expect(enableWorktreeFn).not.toHaveBeenCalled();
  });

  it('throws when project is not found', async () => {
    const sourceChat = makeChat();

    const deps = makeDeps();
    deps.activeChats.set('chat-source', { chat: sourceChat, session: null });
    (deps.db.projects.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const manager = new ChatLifecycleManager(deps);
    const enableWorktreeFn = vi.fn();

    await expect(manager.forkToWorktree('chat-source', 'main', 'feat/fork', enableWorktreeFn)).rejects.toThrow(
      'Project not found',
    );

    expect(enableWorktreeFn).not.toHaveBeenCalled();
  });

  it('finds source chat from DB when not in activeChats', async () => {
    const sourceChat = makeChat();
    const newChat = makeChat({ id: 'chat-new' });

    const deps = makeDeps();
    // Not in activeChats — falls back to db.chats.get
    (deps.db.chats.get as ReturnType<typeof vi.fn>).mockReturnValue(sourceChat);
    (deps.db.projects.get as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'proj-1', path: repoDir });
    (deps.db.chats.create as ReturnType<typeof vi.fn>).mockReturnValue(newChat);

    const manager = new ChatLifecycleManager(deps);
    const enableWorktreeFn = vi.fn().mockResolvedValue(undefined);

    const result = await manager.forkToWorktree('chat-source', 'main', 'feat/fork', enableWorktreeFn);

    expect(result).toEqual({ chatId: 'chat-new' });
    expect(deps.db.chats.get).toHaveBeenCalledWith('chat-source');
  });
});
