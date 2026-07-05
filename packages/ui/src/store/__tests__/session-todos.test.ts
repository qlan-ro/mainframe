import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

let emit: (e: DaemonEvent) => void = () => {};
const unsub = vi.fn();
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: (e: DaemonEvent) => void) => {
      emit = h;
      return unsub;
    },
  },
}));

import { installSessionTodosSubscriber, useSessionTodos, useSessionTodosStore } from '../session-todos';

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({
  content,
  status,
  activeForm: `${content}ing`,
});

beforeEach(() => {
  useSessionTodosStore.setState({ byChat: {} });
  emit = () => {};
});

describe('session-todos store', () => {
  it('stores todos per chat from todos.updated events', () => {
    installSessionTodosSubscriber();
    emit({ type: 'todos.updated', chatId: 'c1', todos: [todo('A', 'pending')] } as DaemonEvent);
    emit({ type: 'todos.updated', chatId: 'c2', todos: [] } as DaemonEvent);
    expect(useSessionTodosStore.getState().byChat['c1']).toEqual([todo('A', 'pending')]);
    expect(useSessionTodosStore.getState().byChat['c2']).toEqual([]);
  });

  it('ignores non-todos events', () => {
    installSessionTodosSubscriber();
    emit({ type: 'context.updated', chatId: 'c1' } as DaemonEvent);
    expect(useSessionTodosStore.getState().byChat).toEqual({});
  });

  it('the latest todos.updated for a chat replaces the prior list', () => {
    installSessionTodosSubscriber();
    emit({ type: 'todos.updated', chatId: 'c1', todos: [todo('A', 'pending')] } as DaemonEvent);
    emit({ type: 'todos.updated', chatId: 'c1', todos: [todo('B', 'completed')] } as DaemonEvent);
    expect(useSessionTodosStore.getState().byChat['c1']).toEqual([todo('B', 'completed')]);
  });

  it('returns the ws-client unsubscribe', () => {
    expect(installSessionTodosSubscriber()).toBe(unsub);
  });

  it('useSessionTodos returns [] before any event and reflects the chat once todos arrive', () => {
    const { result } = renderHook(() => useSessionTodos('c1'));
    const before = result.current;
    expect(before).toEqual([]);
    act(() => {
      installSessionTodosSubscriber();
      emit({ type: 'todos.updated', chatId: 'c1', todos: [todo('A', 'in_progress')] } as DaemonEvent);
    });
    expect(result.current).toEqual([todo('A', 'in_progress')]);
  });

  it('useSessionTodos returns a stable empty-array reference for an unknown chat', () => {
    const { result, rerender } = renderHook(() => useSessionTodos('missing'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first); // stable ref → no spurious re-renders
  });
});
