import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { parseDelegateResult } from '@/features/chat/orchestration/delegate-result';
import { isErrorResult, resolveResultText } from '@/features/chat/tools/shared';
import type { DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';

export type ActivityKind = 'workflow' | 'subagent' | 'delegated' | 'monitor' | 'scheduled' | 'command' | 'background';
/** `needs-you`, `running`, `queued` and `scheduled` are ongoing; the rest are finished. */
export type ActivityState =
  'needs-you' | 'running' | 'queued' | 'scheduled' | 'completed' | 'failed' | 'stopped' | 'removed';
export interface ActivitySource {
  messageId: string;
  toolCallId?: string;
  approximate?: boolean;
}
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  state: ActivityState;
  startedAt: number;
  endedAt?: number;
  nextAt?: number;
  prompt?: string;
  schedule?: string;
  /** A schedule that runs more than once. */
  recurring?: boolean;
  command?: string;
  summary?: string;
  usage?: { totalTokens: number; toolUses: number; durationMs: number };
  source?: ActivitySource;
  task?: BackgroundTask;
  delegated?: DelegatedTaskRow;
}

interface ToolRef {
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  createdAt: number;
}

const string = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function resultRecord(value: unknown): Record<string, unknown> {
  const { text } = resolveResultText(value);
  try {
    return record(JSON.parse(text));
  } catch {
    return record(value);
  }
}

/**
 * Tool refs per message. A settled message keeps its identity while the tail
 * streams, so a chunk re-scans only the message that moved, not the transcript.
 */
const toolsByMessage = new WeakMap<ThreadMessage, readonly ToolRef[]>();

function messageTools(message: ThreadMessage): readonly ToolRef[] {
  const cached = toolsByMessage.get(message);
  if (cached) return cached;
  const tools: ToolRef[] = [];
  for (const part of message.content) {
    if (part.type !== 'tool-call') continue;
    tools.push({
      messageId: message.id,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: record(part.args),
      result: part.result,
      isError: isErrorResult(part.result, part.isError),
      createdAt: message.createdAt?.getTime() ?? 0,
    });
  }
  toolsByMessage.set(message, tools);
  return tools;
}

export function transcriptTools(messages: readonly ThreadMessage[]): ToolRef[] {
  return messages.flatMap((message) => (message.role === 'assistant' ? messageTools(message) : []));
}

function taskKind(task: BackgroundTask): ActivityKind {
  if (task.kind === 'workflow') return 'workflow';
  if (task.kind === 'agent') return 'subagent';
  if (task.toolName === 'Monitor') return 'monitor';
  if (task.kind === 'bash') return 'command';
  return 'background';
}

function monitorTarget(args: Record<string, unknown>, fallback: string): string {
  const server = string(args.server) || string(args.serverName) || string(args.mcp_server);
  const tool = string(args.tool) || string(args.toolName) || string(args.mcp_tool);
  return (
    string(args.command) ||
    string(args.url) ||
    string(args.websocketUrl) ||
    string(args.websocket_url) ||
    [server, tool].filter(Boolean).join(' / ') ||
    fallback
  );
}

export function taskEntries(tasks: readonly BackgroundTask[], tools: readonly ToolRef[]): ActivityEntry[] {
  const byCall = new Map(tools.map((tool) => [tool.toolCallId, tool]));
  return tasks.flatMap((task) => {
    const kind = taskKind(task);
    const tool = byCall.get(task.toolUseId);
    if (kind === 'command' && task.status !== 'running' && tool?.args.run_in_background !== true) return [];
    const args = tool?.args ?? {};
    const source = tool && { messageId: tool.messageId, toolCallId: tool.toolCallId };
    const command = kind === 'monitor' ? monitorTarget(args, task.command) : task.command;
    const title = kind === 'workflow' ? task.workflowName || task.description : task.description || command;
    const detail =
      kind === 'subagent'
        ? [tool?.toolName === 'CollabAgent' ? 'Codex agent' : string(args.subagent_type) || 'Agent', string(args.model)]
            .filter(Boolean)
            .join(' · ')
        : kind === 'monitor'
          ? command
          : kind === 'command'
            ? command
            : kind === 'background'
              ? 'Background task'
              : 'Workflow';
    return [
      {
        id: `task:${task.id}`,
        kind,
        title: title || (kind === 'background' ? 'Background task' : kind),
        detail,
        state: task.status,
        startedAt: task.startedAt,
        endedAt: task.endedAt ?? undefined,
        prompt: string(args.prompt) || undefined,
        command,
        summary: task.summary ?? undefined,
        usage: task.usage ?? undefined,
        source,
        task,
      },
    ];
  });
}

const ONGOING: readonly ActivityState[] = ['needs-you', 'running', 'queued', 'scheduled'];
export const isOngoing = (state: ActivityState): boolean => ONGOING.includes(state);

function delegatedState(row: DelegatedTaskRow): ActivityState {
  if (row.resumedState) return row.resumedState === 'waiting' ? 'needs-you' : 'running';
  switch (row.status) {
    case 'completed':
    case 'failed':
      return row.status;
    case 'cancelled':
    case 'interrupted':
      return 'stopped';
    default:
      if (row.waiting) return 'needs-you';
      return row.status === 'queued' ? 'queued' : 'running';
  }
}

export function delegatedEntries(rows: readonly DelegatedTaskRow[], tools: readonly ToolRef[]): ActivityEntry[] {
  const sources = new Map<string, ToolRef>();
  for (const tool of tools) {
    if (!tool.toolName.endsWith('delegate_task')) continue;
    const parsed = parseDelegateResult(resolveResultText(tool.result).text);
    if (parsed) sources.set(parsed.taskId, tool);
  }
  return rows.map((row) => {
    const tool = sources.get(row.taskId);
    const source = tool && { messageId: tool.messageId, toolCallId: tool.toolCallId };
    const state = delegatedState(row);
    return {
      id: `delegated:${row.taskId}`,
      kind: 'delegated',
      title: row.title,
      detail: [row.resumedState ? `Resumed chat · task ${row.status}` : 'Child chat', row.adapterId, row.model]
        .filter(Boolean)
        .join(' · '),
      state,
      startedAt: tool?.createdAt ?? row.updatedAt,
      endedAt: isOngoing(state) ? undefined : row.updatedAt,
      prompt: string(tool?.args.task) || undefined,
      source,
      delegated: row,
    };
  });
}

function scheduledEntry(tool: ToolRef): ActivityEntry | null {
  if (tool.isError || tool.result === undefined) return null;
  const output = resultRecord(tool.result);
  const name = tool.toolName.split('__').pop();
  if (name !== 'CronCreate' && name !== 'ScheduleWakeup') return null;
  const prompt = string(tool.args.prompt);
  const delay = Number(tool.args.delaySeconds);
  const nextRaw = output.nextRunAt ?? output.nextRunAtMs ?? output.scheduledAt;
  const parsedNext = typeof nextRaw === 'number' ? nextRaw : Date.parse(string(nextRaw));
  const nextAt = Number.isFinite(parsedNext)
    ? parsedNext
    : name === 'ScheduleWakeup' && delay > 0
      ? tool.createdAt + delay * 1000
      : undefined;
  const schedule = name === 'CronCreate' ? string(output.humanSchedule || tool.args.cron) : '';
  const id = string(output.id) || tool.toolCallId;
  const recurring = Boolean(output.recurring ?? tool.args.recurring);
  const cadence = recurring ? 'Every' : 'Once';
  const detail =
    name === 'ScheduleWakeup'
      ? 'Once · wakeup'
      : schedule.toLowerCase().startsWith(cadence.toLowerCase())
        ? schedule
        : `${cadence} ${schedule}`.trim();
  return {
    id: `schedule:${id}`,
    kind: 'scheduled',
    title: prompt || string(tool.args.reason) || 'Scheduled work',
    detail,
    state: 'scheduled',
    recurring,
    startedAt: tool.createdAt,
    nextAt,
    prompt: prompt || undefined,
    schedule: schedule || undefined,
    source: { messageId: tool.messageId, toolCallId: tool.toolCallId },
  };
}

export function scheduledEntries(tools: readonly ToolRef[]): ActivityEntry[] {
  const rows = new Map<string, ActivityEntry>();
  for (const tool of tools) {
    const entry = scheduledEntry(tool);
    if (entry) {
      rows.set(entry.id, entry);
      continue;
    }
    if (tool.toolName.split('__').pop() === 'CronDelete' && !tool.isError && tool.result !== undefined) {
      const previous = rows.get(`schedule:${string(tool.args.id)}`);
      if (previous) rows.set(previous.id, { ...previous, state: 'removed', endedAt: tool.createdAt });
    }
  }
  return [...rows.values()];
}

function containsToolCall(messages: readonly ThreadMessage[] | undefined, ids: ReadonlySet<string>): boolean {
  return (messages ?? []).some((message) =>
    message.content.some(
      (part) => part.type === 'tool-call' && (ids.has(part.toolCallId) || containsToolCall(part.messages, ids)),
    ),
  );
}

/** The tool calls that started an agent now waiting on one of these requests. */
export function agentsAwaiting(
  messages: readonly ThreadMessage[],
  pendingToolIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const awaiting = new Set<string>();
  if (pendingToolIds.size === 0) return awaiting;
  for (const message of messages)
    for (const part of message.content)
      if (part.type === 'tool-call' && containsToolCall(part.messages, pendingToolIds)) awaiting.add(part.toolCallId);
  return awaiting;
}

/** A running agent with a request open above the composer needs you. */
export function markNeedsYou(entries: ActivityEntry[], awaiting: ReadonlySet<string>): ActivityEntry[] {
  if (awaiting.size === 0) return entries;
  return entries.map((entry) =>
    entry.kind === 'subagent' && entry.state === 'running' && entry.task && awaiting.has(entry.task.toolUseId)
      ? { ...entry, state: 'needs-you' }
      : entry,
  );
}

export function anchorEntries(entries: ActivityEntry[], messages: readonly ThreadMessage[]): ActivityEntry[] {
  const assistants = messages.filter((message) => message.role === 'assistant');
  const candidates = assistants.length ? assistants : messages;
  return entries.map((entry) => {
    if (entry.source || candidates.length === 0) return entry;
    const prior = candidates.filter((message) => (message.createdAt?.getTime() ?? Infinity) <= entry.startedAt);
    const nearest = prior.length
      ? prior[prior.length - 1]!
      : (candidates.find((message) => message.createdAt) ?? candidates[candidates.length - 1]!);
    return { ...entry, source: { messageId: nearest.id, approximate: true } };
  });
}
