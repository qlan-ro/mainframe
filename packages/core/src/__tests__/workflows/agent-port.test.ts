// packages/core/src/__tests__/workflows/agent-port.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeChatManagerPort } from '../../workflows/agent-port.js';

describe('makeChatManagerPort', () => {
  const mockChat = { id: 'chat-9', projectId: 'proj-1' };

  function makeChats(overrides?: Partial<{ createChatWithDefaults: unknown; sendMessage: unknown }>) {
    return {
      createChatWithDefaults: vi.fn().mockResolvedValue(mockChat),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('creates a chat then sends the prompt with the correct args', async () => {
    const chats = makeChats();
    const getDefaultProjectId = vi.fn().mockReturnValue('proj-1');
    const port = makeChatManagerPort(chats as never, getDefaultProjectId);

    const result = await port.createChatAndSend({
      projectId: undefined,
      adapterId: 'claude',
      model: 'claude-opus',
      permissionMode: 'default',
      worktree: undefined,
      prompt: 'Write a test',
      origin: { runId: 'run-1', stepPath: 'steps.0' },
    });

    expect(result).toEqual({ chatId: 'chat-9' });

    // createChatWithDefaults called with (projectId, adapterId, model, permissionMode, worktreePath?, branchName?)
    expect(chats.createChatWithDefaults).toHaveBeenCalledOnce();
    expect(chats.createChatWithDefaults).toHaveBeenCalledWith(
      'proj-1',
      'claude',
      'claude-opus',
      'default',
      undefined,
      undefined,
    );

    // sendMessage called with (chatId, prompt)
    expect(chats.sendMessage).toHaveBeenCalledOnce();
    expect(chats.sendMessage).toHaveBeenCalledWith('chat-9', 'Write a test');
  });

  it('passes worktree branchName when worktree arg is provided', async () => {
    const chats = makeChats();
    const port = makeChatManagerPort(chats as never, () => 'proj-1');

    await port.createChatAndSend({
      projectId: 'proj-1',
      adapterId: 'claude',
      model: undefined,
      permissionMode: undefined,
      worktree: { branchName: 'feat/my-branch' },
      prompt: 'Hello',
      origin: { runId: 'run-2', stepPath: 'steps.1' },
    });

    expect(chats.createChatWithDefaults).toHaveBeenCalledWith(
      'proj-1',
      'claude',
      undefined,
      undefined,
      undefined,
      'feat/my-branch',
    );
  });

  it('throws a clear error when no project is available', async () => {
    const chats = makeChats();
    const port = makeChatManagerPort(chats as never, () => null);

    await expect(
      port.createChatAndSend({
        projectId: undefined,
        adapterId: 'claude',
        model: undefined,
        permissionMode: undefined,
        worktree: undefined,
        prompt: 'Hello',
        origin: { runId: 'run-3', stepPath: 'steps.0' },
      }),
    ).rejects.toThrow('agent step requires a projectId');
  });
});
