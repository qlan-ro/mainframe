/**
 * useGateQueue (G5) — every request waiting on the user, oldest first, across
 * the session's own, its sub-agents' and its delegated tasks'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ControlRequest } from '@qlan-ro/mainframe-types';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';

let mockMessages: readonly unknown[] = [];
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: { thread: { messages: readonly unknown[] } }) => unknown) =>
    select({ thread: { messages: mockMessages } }),
}));

let mockExtras: unknown;
vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => mockExtras }));

import { useDelegatedGates } from '../delegated-gates-store';
import { useGateQueue } from '../use-gate-queue';

const request = (id: string, toolUseId = `tu-${id}`): ControlRequest => ({
  requestId: id,
  toolName: 'Bash',
  toolUseId,
  input: {},
  suggestions: [],
});

const entry = (id: string, askedAt: number, toolUseId?: string): ChatPermissionEntry => ({
  requestId: id,
  askedAt,
  request: request(id, toolUseId),
  options: [],
});

function setExtras(permissions: ChatPermissionEntry[], overrides: Record<string, unknown> = {}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  mockExtras = {
    permissions: Object.fromEntries(permissions.map((p) => [p.requestId, p])),
    replyToPermission: reply,
    state: { chatId: 'chat-1', chatConfig: { adapterId: 'claude', permissionMode: 'acceptEdits' }, ...overrides },
  };
  return reply;
}

const agentCall = (toolCallId: string, args: Record<string, unknown>, innerToolCallId: string) => ({
  type: 'tool-call',
  toolCallId,
  toolName: 'Agent',
  args,
  messages: [
    {
      id: 'inner',
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: innerToolCallId, toolName: 'Bash', args: {} }],
    },
  ],
});

beforeEach(() => {
  mockMessages = [];
  mockExtras = undefined;
  useDelegatedGates.setState({ byTask: {} });
  resetAdapters();
});

describe('useGateQueue', () => {
  it('is empty with no chat runtime', () => {
    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front).toBeUndefined();
    expect(result.current.more).toBe(0);
  });

  it('is empty with no pending requests', () => {
    setExtras([]);

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front).toBeUndefined();
    expect(result.current.more).toBe(0);
  });

  it('fronts the oldest request and counts the rest as "more"', () => {
    setExtras([entry('r3', 30), entry('r1', 10), entry('r2', 20)]);

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front?.entry.requestId).toBe('r1');
    expect(result.current.more).toBe(2);
  });

  it('carries the session’s adapter, permission mode and reply for its own request', async () => {
    const reply = setExtras([entry('r1', 10)]);

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front).toMatchObject({ adapterId: 'claude', mode: 'acceptEdits', from: null });
    await result.current.front!.reply({ requestId: 'r1', toolUseId: 'tu-r1', toolName: 'Bash', behavior: 'deny' });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('names the sub-agent whose Agent call holds the request', () => {
    mockMessages = [
      {
        id: 'm',
        role: 'assistant',
        content: [agentCall('agent-1', { subagent_type: 'code-reviewer', description: 'Review the diff' }, 'tu-r1')],
      },
    ];
    setExtras([entry('r1', 10, 'tu-r1')]);

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front?.from).toMatchObject({ name: 'code-reviewer', title: 'Review the diff' });
    expect(result.current.waitingCalls).toEqual(new Set(['agent-1']));
  });

  it('`from.matches` picks out the asking sub-agent’s activity row only', () => {
    mockMessages = [{ id: 'm', role: 'assistant', content: [agentCall('agent-1', { description: 'x' }, 'tu-r1')] }];
    setExtras([entry('r1', 10, 'tu-r1')]);

    const { result } = renderHook(() => useGateQueue());
    const { matches } = result.current.front!.from!;

    expect(matches({ source: { messageId: 'm', toolCallId: 'agent-1' } } as never)).toBe(true);
    expect(matches({ source: { messageId: 'm', toolCallId: 'agent-2' } } as never)).toBe(false);
  });

  it('has no sub-agent for the session’s own tool call', () => {
    mockMessages = [{ id: 'm', role: 'assistant', content: [agentCall('agent-1', { description: 'x' }, 'tu-other')] }];
    setExtras([entry('r1', 10, 'tu-own')]);

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front?.from).toBeNull();
    expect(result.current.waitingCalls.size).toBe(0);
  });

  it('merges a delegated task’s request into the queue by age, naming the task’s adapter', () => {
    seedAdapters([
      { id: 'codex', name: 'Codex', description: '', installed: true, models: [], capabilities: { planMode: false } },
    ]);
    setExtras([entry('own', 20)]);
    const taskReply = vi.fn();
    useDelegatedGates.setState({
      byTask: {
        t1: {
          parentChatId: 'chat-1',
          taskId: 't1',
          topTaskId: 't1',
          title: 'Fix the build',
          adapterId: 'codex',
          mode: 'yolo',
          entries: [entry('task-r', 10)],
          reply: taskReply,
        },
      },
    });

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front?.entry.requestId).toBe('task-r');
    expect(result.current.more).toBe(1);
    expect(result.current.front).toMatchObject({ adapterId: 'codex', mode: 'yolo', reply: taskReply });
    expect(result.current.front?.from).toMatchObject({ name: 'Codex task', title: 'Fix the build' });
  });

  it('falls back to "Delegated task" when the task’s adapter is unknown', () => {
    setExtras([]);
    useDelegatedGates.setState({
      byTask: {
        t1: {
          parentChatId: 'chat-1',
          taskId: 't1',
          topTaskId: 't1',
          title: 'T',
          adapterId: 'mystery',
          mode: undefined,
          entries: [entry('task-r', 10)],
          reply: vi.fn(),
        },
      },
    });

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front?.from?.name).toBe('Delegated task');
  });

  it('ignores delegated tasks that belong to another chat', () => {
    setExtras([]);
    useDelegatedGates.setState({
      byTask: {
        t1: {
          parentChatId: 'other-chat',
          taskId: 't1',
          topTaskId: 't1',
          title: 'T',
          adapterId: 'codex',
          mode: undefined,
          entries: [entry('task-r', 10)],
          reply: vi.fn(),
        },
      },
    });

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.front).toBeUndefined();
  });

  it('`from.matches` for a delegated task picks the row of its top task', () => {
    setExtras([]);
    useDelegatedGates.setState({
      byTask: {
        t2: {
          parentChatId: 'chat-1',
          taskId: 't2',
          topTaskId: 't1',
          title: 'Nested',
          adapterId: 'codex',
          mode: undefined,
          entries: [entry('task-r', 10)],
          reply: vi.fn(),
        },
      },
    });

    const { result } = renderHook(() => useGateQueue());
    const { matches } = result.current.front!.from!;

    expect(matches({ delegated: { taskId: 't1' } } as never)).toBe(true);
    expect(matches({ delegated: { taskId: 't2' } } as never)).toBe(false);
  });

  it('does not read the transcript for a sub-agent when nothing waits', () => {
    mockMessages = [{ id: 'm', role: 'assistant', content: [agentCall('agent-1', { description: 'x' }, 'tu-r1')] }];
    setExtras([]);

    const { result } = renderHook(() => useGateQueue());

    expect(result.current.waitingCalls.size).toBe(0);
  });
});
