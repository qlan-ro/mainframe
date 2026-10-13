import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { anchorEntries, delegatedEntries, scheduledEntries, taskEntries, transcriptTools } from '../activity-model';

function tool(id: string, name: string, args: Record<string, unknown>, result: unknown, minute = 0): ThreadMessage {
  return {
    id: `message-${id}`,
    role: 'assistant',
    createdAt: new Date(60_000 * minute),
    content: [{ type: 'tool-call', toolCallId: id, toolName: name, args, result }],
  } as unknown as ThreadMessage;
}

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'agent-1',
    kind: 'agent',
    toolName: 'Bash',
    toolUseId: 'call-1',
    command: 'Review code',
    description: 'Review code',
    outputPath: null,
    startedAt: 60_000,
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
    ...overrides,
  };
}

describe('Activity source and metadata', () => {
  it('uses Claude description and tool metadata, with an exact transcript anchor', () => {
    const tools = transcriptTools([
      tool(
        'call-1',
        'Task',
        {
          description: 'Review code',
          subagent_type: 'explorer',
          prompt: 'Inspect both paths',
        },
        undefined,
      ),
    ]);
    expect(taskEntries([task()], tools)).toMatchObject([
      {
        title: 'Review code',
        detail: 'explorer',
        prompt: 'Inspect both paths',
        source: { messageId: 'message-call-1', toolCallId: 'call-1' },
      },
    ]);
  });

  it('uses the Codex task name stored in the tracker', () => {
    const tools = transcriptTools([tool('call-1', 'CollabAgent', { description: 'Review code' }, undefined)]);
    expect(taskEntries([task({ description: 'ui_parity' })], tools)[0]).toMatchObject({
      title: 'ui_parity',
      detail: 'Codex agent',
    });
  });

  it('shows a command only when its Bash call explicitly requested background execution', () => {
    const foreground = transcriptTools([tool('call-1', 'Bash', { command: 'ls' }, undefined)]);
    const background = transcriptTools([
      tool(
        'call-1',
        'Bash',
        {
          command: 'pnpm build',
          run_in_background: true,
        },
        undefined,
      ),
    ]);
    const command = task({ kind: 'bash', command: 'pnpm build', description: 'Build' });
    expect(taskEntries([command], foreground)).toEqual([]);
    expect(taskEntries([command], background)[0]).toMatchObject({
      kind: 'command',
      title: 'Build',
      command: 'pnpm build',
    });
  });

  it('uses a Monitor call target when the tracker retained only its description', () => {
    const monitor = task({ kind: 'other', toolName: 'Monitor', command: 'Watch events' });
    const websocket = transcriptTools([tool('call-1', 'Monitor', { url: 'wss://events.example' }, undefined)]);
    const mcp = transcriptTools([
      tool(
        'call-1',
        'Monitor',
        {
          serverName: 'alerts',
          toolName: 'watch_incidents',
        },
        undefined,
      ),
    ]);
    expect(taskEntries([monitor], websocket)[0]).toMatchObject({
      kind: 'monitor',
      command: 'wss://events.example',
    });
    expect(taskEntries([monitor], mcp)[0]?.command).toBe('alerts / watch_incidents');
  });

  it('keeps schedules waiting until a real delete, including after their due time', () => {
    const tools = transcriptTools([
      tool(
        'create',
        'CronCreate',
        { cron: '*/30 * * * *', prompt: 'Re-run e2e', recurring: true },
        JSON.stringify({ id: 'cron-1', humanSchedule: 'Every 30 min', nextRunAt: 120_000 }),
        1,
      ),
      tool('wakeup', 'ScheduleWakeup', { prompt: 'Check CI', delaySeconds: 240 }, '{}', 1),
    ]);
    expect(scheduledEntries(tools)).toMatchObject([
      { id: 'schedule:cron-1', title: 'Re-run e2e', state: 'waiting', nextAt: 120_000 },
      { id: 'schedule:wakeup', title: 'Check CI', state: 'waiting', nextAt: 300_000 },
    ]);
    const deleted = transcriptTools([tool('delete', 'CronDelete', { id: 'cron-1' }, '{}', 3)]);
    expect(scheduledEntries([...tools, ...deleted])[0]).toMatchObject({ state: 'cancelled', endedAt: 180_000 });
  });

  it('links a delegated child to the call that created it', () => {
    const tools = transcriptTools([
      tool(
        'delegate',
        'mcp__mainframe__delegate_task',
        { task: 'Check tests' },
        JSON.stringify({ taskId: 'task-1', childChatId: 'child-1' }),
        1,
      ),
    ]);
    const rows = [
      {
        taskId: 'task-1',
        itemId: 'child-1',
        title: 'Check tests',
        status: 'running' as const,
        waiting: false,
        updatedAt: 120_000,
      },
    ];
    expect(delegatedEntries(rows, tools)).toMatchObject([
      {
        title: 'Check tests',
        detail: 'Child chat',
        prompt: 'Check tests',
        source: { messageId: 'message-delegate', toolCallId: 'delegate' },
      },
    ]);
  });

  it('offers a clearly approximate transcript anchor when a task event lacks a tool id', () => {
    const messages = [tool('early', 'Read', {}, undefined, 1), tool('late', 'Read', {}, undefined, 5)];
    const entries = taskEntries([task({ toolUseId: '', startedAt: 120_000 })], transcriptTools(messages));
    expect(anchorEntries(entries, messages)[0]!.source).toEqual({
      messageId: 'message-early',
      approximate: true,
    });
  });
});
