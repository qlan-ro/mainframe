import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import {
  createChatThreadState,
  type ChatPermissionEntry,
  type ChatThreadState,
} from '../../controller/chat-thread-state';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';

/** The slice of `AcpChatController` the hook drives. */
class FakeController {
  state: ChatThreadState = createChatThreadState('kid');
  readonly listeners = new Set<() => void>();
  readonly release = vi.fn();
  readonly holdActive = vi.fn(() => this.release);
  readonly replyToPermission = vi.fn(async () => {});
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

function gate(requestId: string, askedAt: number): ChatPermissionEntry {
  return {
    requestId,
    askedAt,
    request: { requestId, toolName: 'Bash', toolUseId: `tu-${requestId}`, input: {}, suggestions: [] },
    options: [],
  };
}

beforeEach(() => controllers.clear());

describe('useTaskChat', () => {
  it("holds the child's stream only while mounted", () => {
    const { unmount } = renderHook(() => useTaskChat('kid'), { wrapper });
    const controller = controllers.get('kid')!;
    expect(controller.holdActive).toHaveBeenCalledTimes(1);
    expect(controller.release).not.toHaveBeenCalled();
    unmount();
    expect(controller.release).toHaveBeenCalledTimes(1);
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

  it("surfaces the child's oldest open gate and answers it into the child's session", async () => {
    const { result } = renderHook(() => useTaskChat('kid'), { wrapper });
    const controller = controllers.get('kid')!;
    const interactions = { ...controller.state.interactions, permissions: { b: gate('b', 2), a: gate('a', 1) } };
    act(() => controller.set({ ...controller.state, interactions }));
    expect(result.current.gate?.requestId).toBe('a');

    const response = { requestId: 'a', behavior: 'deny' } as unknown as ControlResponse;
    await result.current.reply(response, 'reject-once');
    expect(controller.replyToPermission).toHaveBeenCalledWith(response, 'reject-once');
  });
});
