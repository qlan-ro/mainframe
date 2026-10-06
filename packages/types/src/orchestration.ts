/**
 * Agent orchestration over MCP (mirrors `mainframe-types/src/orchestration.rs`):
 * the delegated-task record the daemon's `mainframe` MCP server keeps for a
 * child chat an agent started with `delegate_task`.
 */

export type TaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export type TaskWorkState = 'working' | 'waiting_for_children' | 'result_available';

export type TaskRole = 'implementation' | 'research' | 'review' | 'design' | 'test' | 'general';

/** Where the parent's completion delivery stands. */
export type TaskDelivery = 'pending' | 'owed' | 'delivered' | 'acknowledged' | 'dropped';

export interface DelegatedTask {
  id: string;
  parentChatId: string;
  childChatId: string;
  clientRequestId?: string;
  title?: string;
  role: TaskRole;
  status: TaskStatus;
  depth: number;
  summary?: string;
  error?: string;
  cancelReason?: string;
  delivery: TaskDelivery;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** A message the daemon holds for a busy chat (`GET /api/chats/:id/agent-outbox`). */
export interface AgentOutboxEntry {
  entryId: string;
  fromChatId: string;
  preview: string;
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}
