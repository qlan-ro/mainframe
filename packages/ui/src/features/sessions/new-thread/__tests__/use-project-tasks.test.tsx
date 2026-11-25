// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { listTodos, type Todo } from '@/lib/api/todos';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { useProjectTasks } from '../use-project-tasks';

vi.mock('@/lib/api/todos', () => ({ listTodos: vi.fn() }));

it('keeps task data and loading scoped to the selected daemon', async () => {
  const original = getActiveDaemon();
  let resolveOld!: (value: Todo[]) => void;
  const old = new Promise<Todo[]>((done) => (resolveOld = done));
  let resolve!: (value: Todo[]) => void;
  const pending = new Promise<Todo[]>((done) => (resolve = done));
  vi.mocked(listTodos)
    .mockResolvedValueOnce([{ id: 'old', status: 'open' } as Todo])
    .mockReturnValueOnce(old)
    .mockReturnValueOnce(pending);
  try {
    await useTodosStore.getState().load(1, 'project');
    const refresh = useTodosStore.getState().load(1, 'project');
    setActiveDaemon({ ...original, id: 'another-daemon' });
    const { result } = renderHook(() => useProjectTasks(2, 'project'));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.state).toBe('loading');
    await act(async () => {
      resolveOld([{ id: 'late', status: 'open' } as Todo]);
      await refresh;
    });
    expect(result.current.tasks).toEqual([]);
    expect(result.current.state).toBe('loading');
    await act(async () => resolve([]));
    expect(result.current.state).toBe('ready');
  } finally {
    setActiveDaemon(original);
  }
});
