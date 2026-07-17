// @vitest-environment jsdom
/**
 * useStartTodoSession — behavior tests.
 *
 * The daemon's `start-session` creates an EMPTY chat and returns the chatId +
 * initialMessage separately; the client must switch to the new thread and THEN
 * prefill its composer. Because `switchToThread` is async (mainThreadId only
 * catches up when it resolves), the prefill must await the switch — otherwise
 * `setText` targets the previously-active thread's composer and the new chat
 * opens blank (#212).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Runtime + composer spies ─────────────────────────────────────────────────
const reload = vi.fn<() => Promise<void>>();
const switchToThread = vi.fn<(id: string) => Promise<void>>();
const setText = vi.fn<(text: string) => void>();

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({ threads: { reload, switchToThread } }),
  useAui: () => ({ composer: () => ({ setText }) }),
}));

vi.mock('@/lib/api/todos', () => ({
  startTodoSession: vi.fn(),
  moveTodo: vi.fn(),
}));

vi.mock('../use-todos-store', () => ({
  useTodosStore: { getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }) },
}));

import { useStartTodoSession } from '../use-start-todo-session';
import { startTodoSession, moveTodo } from '@/lib/api/todos';

const PORT = 31415;

beforeEach(() => {
  vi.clearAllMocks();
  reload.mockResolvedValue(undefined);
  switchToThread.mockResolvedValue(undefined);
  vi.mocked(startTodoSession).mockResolvedValue({ chatId: 'chat-9', initialMessage: 'Implement the thing' });
});

describe('useStartTodoSession', () => {
  it('does nothing when there is no active project', async () => {
    const { result } = renderHook(() => useStartTodoSession(PORT, undefined));
    await result.current('todo-1');
    expect(startTodoSession).not.toHaveBeenCalled();
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('reloads the list, switches to the new chat, and prefills the composer', async () => {
    const { result } = renderHook(() => useStartTodoSession(PORT, 'proj-1'));
    await result.current('todo-1');

    expect(startTodoSession).toHaveBeenCalledWith(PORT, 'todo-1', 'proj-1');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-9');
    expect(setText).toHaveBeenCalledWith('Implement the thing');
  });

  it('moves an open todo to in_progress before starting the session', async () => {
    const { result } = renderHook(() => useStartTodoSession(PORT, 'proj-1'));
    await result.current('todo-1', 'open');
    expect(moveTodo).toHaveBeenCalledWith(PORT, 'todo-1', 'in_progress');
  });

  it('prefills the composer only AFTER the thread switch resolves (no race)', async () => {
    let resolveSwitch!: () => void;
    switchToThread.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveSwitch = () => r();
        }),
    );

    const { result } = renderHook(() => useStartTodoSession(PORT, 'proj-1'));
    const done = result.current('todo-1');

    // Wait until the switch has been requested; the composer must NOT be
    // prefilled yet because the switch is still pending.
    await vi.waitFor(() => expect(switchToThread).toHaveBeenCalledWith('chat-9'));
    expect(setText).not.toHaveBeenCalled();

    resolveSwitch();
    await done;

    expect(setText).toHaveBeenCalledWith('Implement the thing');
  });
});
