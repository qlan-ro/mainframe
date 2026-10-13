import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { parseDelegateResult } from '@/features/chat/orchestration/delegate-result';
import { isErrorResult, resolveResultText } from '@/features/chat/tools/shared';
import type { DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';

export type ActivityKind = 'workflow' | 'subagent' | 'delegated' | 'monitor' | 'scheduled' | 'command';
export type ActivityState = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'cancelled';
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

export function transcriptTools(messages: readonly ThreadMessage[]): ToolRef[] {
  const tools: ToolRef[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
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
  }
  return tools;
}

function taskKind(task: BackgroundTask): ActivityKind | null {
  if (task.kind === 'workflow') return 'workflow';
  if (task.kind === 'agent') return 'subagent';
  if (task.toolName === 'Monitor') return 'monitor';
  if (task.kind === 'bash') return 'command';
  return null;
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
    if (!kind) return [];
    const tool = byCall.get(task.toolUseId);
    if (kind === 'command' && tool?.args.run_in_background !== true) return [];
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
            : 'Workflow';
    return [
      {
        id: `task:${task.id}`,
        kind,
        title: title || kind,
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
    const state =
      row.status === 'completed'
        ? 'completed'
        : row.status === 'failed'
          ? 'failed'
          : row.status === 'cancelled'
            ? 'cancelled'
            : row.status === 'interrupted'
              ? 'stopped'
              : row.status === 'queued' || row.waiting
                ? 'waiting'
                : 'running';
    return {
      id: `delegated:${row.taskId}`,
      kind: 'delegated',
      title: row.title,
      detail: ['Child chat', row.adapterId, row.model].filter(Boolean).join(' · '),
      state,
      startedAt: tool?.createdAt ?? row.updatedAt,
      endedAt: state === 'running' || state === 'waiting' ? undefined : row.updatedAt,
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
  const cadence = output.recurring || tool.args.recurring ? 'Every' : 'Once';
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
    state: 'waiting',
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
      if (previous) rows.set(previous.id, { ...previous, state: 'cancelled', endedAt: tool.createdAt });
    }
  }
  return [...rows.values()];
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
