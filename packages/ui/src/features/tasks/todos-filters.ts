/**
 * Pure filter/sort helpers for the Tasks surface.
 *
 * Ported from packages/desktop/src/renderer/components/todos/TodoFilterBar.tsx
 * (lines 29–81). No side-effects; safe to test in isolation.
 *
 * Search scope is todo.title ONLY — matches desktop behavior exactly.
 */
import type { Todo, TodoType, TodoPriority } from '@/lib/api/todos';

export interface TodoFilters {
  types: TodoType[];
  priorities: TodoPriority[];
  labels: string[];
  search: string;
}

export type TodoSortKey = 'number' | 'priority' | 'type' | 'updated';
export type TodoSortDir = 'asc' | 'desc';

export interface TodoSort {
  key: TodoSortKey;
  dir: TodoSortDir;
}

const PRIORITY_RANK: Record<TodoPriority, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function sortTodos(todos: Todo[], sort: TodoSort): Todo[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const copy = [...todos];
  copy.sort((a, b) => {
    switch (sort.key) {
      case 'number':
        return (a.number - b.number) * dir;
      case 'priority':
        // `?? 4` required under `noUncheckedIndexedAccess`:
        // PRIORITY_RANK[a.priority] is `number | undefined` in arithmetic.
        return ((PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4)) * dir;
      case 'type':
        return a.type.localeCompare(b.type) * dir;
      case 'updated':
        return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * dir;
      default:
        return 0;
    }
  });
  return copy;
}

export function extractAllLabels(todos: Todo[]): string[] {
  const set = new Set<string>();
  for (const t of todos) for (const l of t.labels) set.add(l);
  return [...set].sort();
}

export function matchesFilters(todo: Todo, f: TodoFilters): boolean {
  if (f.types.length > 0 && !f.types.includes(todo.type)) return false;
  if (f.priorities.length > 0 && !f.priorities.includes(todo.priority)) return false;
  if (f.labels.length > 0 && !f.labels.some((l) => todo.labels.includes(l))) return false;
  if (f.search.trim() && !todo.title.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}
