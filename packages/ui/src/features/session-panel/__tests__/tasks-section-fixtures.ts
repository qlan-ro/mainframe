import type { Todo } from '@/lib/api/todos';

function makeTodo(overrides: Partial<Todo> & { id: string; number: number }): Todo {
  return {
    project_id: 'proj-1',
    title: 'Default title',
    body: '',
    status: 'open',
    type: 'feature',
    priority: 'medium',
    labels: [],
    assignees: [],
    milestone: null,
    dependencies: [],
    order_index: 0,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

export const OPEN_TODO = makeTodo({
  id: 'todo-1',
  number: 11,
  title: 'Fix the rail',
  status: 'open',
  updated_at: '2026-06-01T00:00:10.000Z',
});
export const IN_PROGRESS_TODO = makeTodo({
  id: 'todo-2',
  number: 12,
  title: 'Ship the stack',
  status: 'in_progress',
  updated_at: '2026-06-01T00:00:20.000Z',
});
export const DONE_TODO = makeTodo({
  id: 'todo-3',
  number: 13,
  title: 'Old work',
  status: 'done',
  updated_at: '2026-06-01T00:00:00.000Z',
});
export const OPEN_TODO_2 = makeTodo({
  id: 'todo-4',
  number: 14,
  title: 'Polish the empty state',
  status: 'open',
  updated_at: '2026-06-01T00:00:30.000Z',
});
export const IN_PROGRESS_TODO_2 = makeTodo({
  id: 'todo-5',
  number: 15,
  title: 'Wire the daemon route',
  status: 'in_progress',
  updated_at: '2026-06-01T00:00:40.000Z',
});
