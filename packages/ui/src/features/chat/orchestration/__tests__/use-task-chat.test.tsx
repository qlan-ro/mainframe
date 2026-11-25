import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';

/** The slice of `AcpChatController` the hook drives. */
class FakeController {
  state: ChatThreadState = createChatThreadState('kid');
  readonly listeners = new Set<() => void>();
  readonly release = vi.fn();
  readonly holdActive = vi.fn(() => this.release);
  readonly unsubscribe = vi.fn();
  readonly subscribeLive = vi.fn(() => this.unsubscribe);
  getState = () => this.state;
  subscribeState = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(state: ChatThreadState) {
    this.state = state;
    this.listeners.forEach((fn) => fn());
  }
}

const list = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: list }));

const controllers = new Map<string, FakeController>();
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (chatId: string) => {
      const existing = controllers.get(chatId);
      if (existing) return existing;
      const made = new FakeController();
      controllers.set(chatId, made);
      return made;
    },
  },
}));

import { useTaskChat } from '../use-task-chat';
import { TASK_CHAT_WINDOW } from '../task-chat-window';

function wrapper({ children }: { children: ReactNode }) {
  return <DaemonPortProvider port={31415}>{children}</DaemonPortProvider>;
}

function message(i: number): ThreadMessageLike {
  return { id: `m${i}`, role: 'assistant', createdAt: new Date(i), content: [{ type: 'text', text: `m${i}` }] };
}

beforeEach(() => {
  controllers.clear();
  list.mockReset().mockResolvedValue([]);
});

describe('useTaskChat', () => {
  it("holds the child's stream only while mounted", () => {
    const { unmount } = renderHook(() => useTaskChat('kid'), { wrapper });
    const controller = controllers.get('kid')!;
    expect(controller.holdActive).toHaveBeenCalledTimes(1);
    expect(controller.release).not.toHaveBeenCalled();
    unmount();
    expect(controller.release).toHaveBeenCalledTimes(1);
    expect(controller.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('knows its own sub-agents: what runs, what is listed, and which of its parts are over', async () => {
    list.mockResolvedValue([{ id: 'bg', toolUseId: 'late', status: 'running', startedAt: 1 }]);
    const { result } = renderHook(() => useTaskChat('kid'), { wrapper });
    expect(result.current.world).toMatchObject({ runs: false, tasks: null });
    expect(list).not.toHaveBeenCalled();
    const agent = (id: string): ThreadMessageLike => ({
      id: `a-${id}`,
      role: 'assistant',
      createdAt: new Date(1),
      content: [{ type: 'tool-call', toolCallId: id, toolName: 'Task', args: {} }],
      status: { type: 'complete', reason: 'stop' },
    });
    const prompt: ThreadMessageLike = { id: 'u', role: 'user', content: [{ type: 'text', text: 'Go on' }] };
    const controller = controllers.get('kid')!;
    await act(async () =>
      controller.set({
        ...controller.state,
        runState: { type: 'running' } as never,
        messages: [agent('early'), prompt, agent('late')],
      }),
    );
    expect(result.current.world).toMatchObject({ runs: true, live: true, tasks: [{ id: 'bg' }] });
    expect(result.current.world.over).toEqual(new Set(['early']));
    expect(list).toHaveBeenCalledWith('kid', expect.anything());
  });

  it('shows the latest messages and counts the rest', () => {
    const { result } = renderHook(() => useTaskChat('kid'), { wrapper });
    const controller = controllers.get('kid')!;
    const total = TASK_CHAT_WINDOW + 5;
    act(() => controller.set({ ...controller.state, messages: Array.from({ length: total }, (_, i) => message(i)) }));
    expect(result.current.hiddenCount).toBe(5);
    expect(result.current.messages).toHaveLength(TASK_CHAT_WINDOW);
    expect(result.current.messages[0]!.id).toBe('m5');
  });

  it('exposes the pending tool ID, and no reply handler', () => {
    const { result } = renderHook(() => useTaskChat('kid'), { wrapper });
    const controller = controllers.get('kid')!;
    act(() =>
      controller.set(
        reduceChatThreadState(controller.state, {
          type: 'permission.requested',
          requestId: 'req',
          request: { requestId: 'req', toolUseId: 'cmd', toolName: 'Bash', input: {}, suggestions: [] },
          options: [],
        }),
      ),
    );

    expect(result.current).not.toHaveProperty('reply');
    expect(result.current.pendingToolIds).toEqual(new Set(['cmd']));
  });
});
