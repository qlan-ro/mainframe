/**
 * Reads the `delegate_task` tool result: the `TaskResult` object the daemon's
 * MCP server returns as the tool's text (spec "Tool results"). Tolerant of a
 * CLI that pretty-prints it or prefixes prose — the first JSON object wins.
 */
import type { TaskStatus } from '@qlan-ro/mainframe-types';

export interface DelegateResult {
  taskId: string;
  childChatId: string;
  title?: string;
  status?: TaskStatus;
}

const TASK_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function firstObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    /* expected: a failed call's text is prose, not a TaskResult */
    return null;
  }
}

export function parseDelegateResult(text: string): DelegateResult | null {
  const value = firstObject(text);
  if (value == null) return null;
  const { taskId, childChatId, title, status } = value;
  if (typeof taskId !== 'string' || typeof childChatId !== 'string') return null;
  return {
    taskId,
    childChatId,
    title: typeof title === 'string' ? title : undefined,
    status: typeof status === 'string' && TASK_STATUSES.has(status) ? (status as TaskStatus) : undefined,
  };
}
