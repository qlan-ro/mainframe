/**
 * sort-updated.test.ts
 *
 * Behaviors covered for the 'updated' sort key (tasks-6):
 *
 *  1. sortTodos with key='updated' desc sorts newer updated_at first.
 *  2. sortTodos with key='updated' asc sorts older updated_at first.
 *  3. TodoSortKey type includes 'updated' (compile-time guard enforced by usage).
 */
import { describe, it, expect } from 'vitest';
import { sortTodos } from '../todos-filters';
import type { Todo } from '@/lib/api/todos';
import type { TodoSort } from '../todos-filters';

function makeTodo(id: string, number: number, updated_at: string): Todo {
  return {
    id,
    number,
    project_id: 'proj-1',
    title: `Task ${number}`,
    body: '',
    status: 'open',
    type: 'feature',
    priority: 'medium',
    labels: [],
    assignees: [],
    milestone: null,
    dependencies: [],
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at,
  };
}

const OLDER = makeTodo('a', 1, '2026-01-10T00:00:00.000Z');
const NEWER = makeTodo('b', 2, '2026-06-15T00:00:00.000Z');
const MIDDLE = makeTodo('c', 3, '2026-03-01T00:00:00.000Z');

describe('sortTodos — by updated_at', () => {
  it('descending: newest updated_at first', () => {
    const sort: TodoSort = { key: 'updated', dir: 'desc' };
    const result = sortTodos([OLDER, NEWER, MIDDLE], sort);
    expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('ascending: oldest updated_at first', () => {
    const sort: TodoSort = { key: 'updated', dir: 'asc' };
    const result = sortTodos([OLDER, NEWER, MIDDLE], sort);
    expect(result.map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the original array', () => {
    const original = [NEWER, OLDER];
    const sort: TodoSort = { key: 'updated', dir: 'asc' };
    sortTodos(original, sort);
    expect(original[0]?.id).toBe('b');
    expect(original[1]?.id).toBe('a');
  });
});
