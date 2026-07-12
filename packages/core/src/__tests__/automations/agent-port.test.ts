// packages/core/src/__tests__/automations/agent-port.test.ts
//
// Task 23. Ports v1 workflows/agent-port.ts onto v2's AgentChatPort
// (verbs/ask-agent.ts) — no `origin` field, and it adds `sendMessage` so the
// A2 corrective retry (agent-waits.ts) can message an existing chat.
import { describe, it, expect, vi } from 'vitest';
import { makeAutomationChatPort } from '../../automations/agent-port.js';

describe('makeAutomationChatPort', () => {
  const mockChat = { id: 'chat-9' };

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
    const port = makeAutomationChatPort(chats as never, getDefaultProjectId);

    const result = await port.createChatAndSend({
      projectId: undefined,
      adapterId: 'claude',
      model: 'claude-opus',
      permissionMode: 'default',
      worktree: undefined,
      prompt: 'Write a test',
    });

    expect(result).toEqual({ chatId: 'chat-9' });
    expect(chats.createChatWithDefaults).toHaveBeenCalledWith(
      'proj-1',
      'claude',
      'claude-opus',
      'default',
      undefined,
      undefined,
    );
    expect(chats.sendMessage).toHaveBeenCalledWith('chat-9', 'Write a test');
  });

  it('passes worktree branchName when a worktree arg is provided', async () => {
    const chats = makeChats();
    const port = makeAutomationChatPort(chats as never, () => 'proj-1');

    await port.createChatAndSend({
      projectId: 'proj-1',
      adapterId: 'claude',
      model: undefined,
      permissionMode: undefined,
      worktree: { branchName: 'feat/my-branch' },
      prompt: 'Hello',
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
    const port = makeAutomationChatPort(chats as never, () => null);

    await expect(
      port.createChatAndSend({
        projectId: undefined,
        adapterId: 'claude',
        model: undefined,
        permissionMode: undefined,
        worktree: undefined,
        prompt: 'Hello',
      }),
    ).rejects.toThrow('requires a projectId');
  });

  it('sendMessage delegates straight through to ChatManager', async () => {
    const chats = makeChats();
    const port = makeAutomationChatPort(chats as never, () => 'proj-1');

    await port.sendMessage('chat-9', 'a correction');

    expect(chats.sendMessage).toHaveBeenCalledWith('chat-9', 'a correction');
  });
});
