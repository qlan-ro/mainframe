/**
 * Agent provenance view-model (orchestration MCP server): who started a chat,
 * and the delegated tasks a parent is running. Pure — reads only the session
 * list's projection of `Chat.createdByChatId` / `Chat.delegation`.
 */
import {
  isTerminalTaskStatus,
  type AgentOutboxEntry,
  type ChatDelegation,
  type TaskStatus,
} from '@qlan-ro/mainframe-types';
import type { SessionCustom, SessionItem } from './chat-to-thread-custom';

const UNTITLED = 'Untitled session';

/** `waiting_for_children` → `waiting for children`. */
export function taskStatusLabel(status: TaskStatus): string {
  return status.replace(/_/g, ' ');
}

/** The hover card's delegated-by value: `"<parent>" · <role> · <status>`. */
export function delegatedByValue(parent: string, delegation: ChatDelegation): string {
  return `${parent} · ${delegation.role} · ${taskStatusLabel(delegation.status)}`;
}

/**
 * The quoted title of the chat whose agent launched this one. Absent for the
 * user's own chats and for delegated children, whose parent line already
 * names their creator.
 */
export function startedByTitle(
  allItems: readonly SessionItem[],
  custom: Pick<SessionCustom, 'createdByChatId' | 'delegation'>,
): string | undefined {
  const creator = custom.createdByChatId;
  if (creator == null || custom.delegation != null) return undefined;
  const found = allItems.find((it) => (it.remoteId ?? it.id) === creator);
  return `"${found?.title ?? UNTITLED}"`;
}

export interface DelegatedTaskRow {
  taskId: string;
  /** The thread-list item id, for switching to the child. */
  itemId: string;
  title: string;
  status: TaskStatus;
  /** The child waits on a permission or question gate. */
  waiting: boolean;
  updatedAt: number;
}

/** A parent's delegated children, most recently active first, archived ones included. */
export function delegatedTasksOf(items: readonly SessionItem[], parentChatId: string): DelegatedTaskRow[] {
  const rows: DelegatedTaskRow[] = [];
  for (const it of items) {
    const delegation = it.custom.delegation;
    if (delegation == null || it.custom.parentChatId !== parentChatId) continue;
    rows.push({
      taskId: delegation.taskId,
      itemId: it.id,
      title: it.title ?? UNTITLED,
      status: delegation.status,
      waiting: delegation.status === 'waiting' || it.custom.hasPending,
      updatedAt: it.custom.updatedAt,
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface TaskCounts {
  running: number;
  waiting: number;
  done: number;
}

export function countTasks(rows: readonly DelegatedTaskRow[]): TaskCounts {
  const counts: TaskCounts = { running: 0, waiting: 0, done: 0 };
  for (const row of rows) {
    if (isTerminalTaskStatus(row.status)) counts.done++;
    else if (row.waiting) counts.waiting++;
    else counts.running++;
  }
  return counts;
}

function tasks(n: number): string {
  return `${n} ${n === 1 ? 'task' : 'tasks'}`;
}

/** `N tasks running · M waiting`; once nothing is open, `N tasks done`. */
export function taskChipLabel(counts: TaskCounts): string {
  if (counts.running === 0 && counts.waiting === 0) return `${tasks(counts.done)} done`;
  if (counts.running === 0) return `${tasks(counts.waiting)} waiting`;
  const head = `${tasks(counts.running)} running`;
  return counts.waiting > 0 ? `${head} · ${counts.waiting} waiting` : head;
}

/**
 * The composer chip's headline over the messages held for a chat:
 * `1 message from "<sender>" after this turn`, or a count of senders when
 * several are waiting. `titleOf` returns a sender's quoted title.
 */
export function outboxHeadline(entries: readonly AgentOutboxEntry[], titleOf: (chatId: string) => string): string {
  const senders = new Set(entries.map((e) => e.fromChatId));
  const messages = `${entries.length} ${entries.length === 1 ? 'message' : 'messages'}`;
  const first = entries[0];
  const from = senders.size === 1 && first != null ? titleOf(first.fromChatId) : `${senders.size} chats`;
  return `${messages} from ${from} after this turn`;
}
