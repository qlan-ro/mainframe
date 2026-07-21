import type { Logger } from 'pino';

export interface TodoRow {
  id: string;
  number: number;
  project_id: string;
  title: string;
  body: string;
  status: string;
  type: string;
  priority: string;
  labels: string;
  assignees: string;
  milestone: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  dependencies: string; // JSON array of todo numbers
  closed_at: string | null;
  state_reason: string | null;
  author: string | null;
  remote_repo: string | null;
  remote_number: number | null;
  remote_url: string | null;
  synced_at: string | null;
}

export interface Todo extends Omit<TodoRow, 'labels' | 'assignees' | 'dependencies'> {
  labels: string[];
  assignees: string[];
  dependencies: number[];
}

/**
 * Parse a JSON array column defensively. Historical writes left some rows with
 * double-encoded values (e.g. `[\"a\"]`) that crash `JSON.parse`. A single bad
 * row must not take down the entire board, so fall back to `[]` and log.
 */
export function safeJsonArray<T>(raw: string, column: string, todoId: string, logger?: Logger): T[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err) {
    logger?.warn({ err: String(err), todoId, column, raw }, 'todos: malformed JSON column, defaulting to []');
    return [];
  }
}

export const parseTodo = (r: TodoRow, logger?: Logger): Todo => ({
  ...r,
  labels: safeJsonArray<string>(r.labels, 'labels', r.id, logger),
  assignees: safeJsonArray<string>(r.assignees, 'assignees', r.id, logger),
  dependencies: safeJsonArray<number>(r.dependencies, 'dependencies', r.id, logger),
});
