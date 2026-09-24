/**
 * Behavior tests for handleDaemonEvent — background_task.* mapping.
 * Fixed input events, hardcoded expected HandleResults.
 */
import { describe, it, expect } from 'vitest';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { handleDaemonEvent } from '../handle-daemon-event';

const CHAT_ID = 'chat-abc';
const OTHER_CHAT = 'chat-other';
function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'a-1',
    kind: 'agent',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    command: '',
    description: 'reviewer subagent',
    outputPath: '/p/a-1',
    startedAt: 4200,
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
    ...overrides,
  };
}

describe('handleDaemonEvent — background_task.*', () => {
  it('started → background.upsert with the widened projected activity task', () => {
    const result = handleDaemonEvent({ type: 'background_task.started', chatId: CHAT_ID, task: makeTask() }, CHAT_ID);
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: {
          id: 'a-1',
          kind: 'agent',
          description: 'reviewer subagent',
          startedAt: 4200,
          status: 'running',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
        },
      },
    });
  });

  it('started for another chat → noop', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.started', chatId: OTHER_CHAT, task: makeTask() },
      CHAT_ID,
    );
    expect(result).toEqual({ kind: 'noop' });
  });

  it('updated with running status → background.upsert', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.updated', chatId: CHAT_ID, task: makeTask({ description: 'now longer' }) },
      CHAT_ID,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: {
          id: 'a-1',
          kind: 'agent',
          description: 'now longer',
          startedAt: 4200,
          status: 'running',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
        },
      },
    });
  });

  it('updated with a terminal status → background.ended carrying the terminal projection', () => {
    const result = handleDaemonEvent(
      {
        type: 'background_task.updated',
        chatId: CHAT_ID,
        task: makeTask({ status: 'completed', endedAt: 5000, summary: 'done' }),
      },
      CHAT_ID,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.ended',
        task: {
          id: 'a-1',
          kind: 'agent',
          description: 'reviewer subagent',
          startedAt: 4200,
          status: 'completed',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
          endedAt: 5000,
          summary: 'done',
        },
      },
    });
  });

  it('ended → background.ended carrying the terminal projection', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.ended', chatId: CHAT_ID, task: makeTask({ status: 'stopped', endedAt: 5000 }) },
      CHAT_ID,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.ended',
        task: {
          id: 'a-1',
          kind: 'agent',
          description: 'reviewer subagent',
          startedAt: 4200,
          status: 'stopped',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
          endedAt: 5000,
        },
      },
    });
  });

  it('started with a non-running status (adopt replay of a finished task) → background.ended', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.started', chatId: CHAT_ID, task: makeTask({ status: 'failed', endedAt: 5000 }) },
      CHAT_ID,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.ended',
        task: {
          id: 'a-1',
          kind: 'agent',
          description: 'reviewer subagent',
          startedAt: 4200,
          status: 'failed',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
          endedAt: 5000,
        },
      },
    });
  });

  it('bash task with empty description falls back to the command', () => {
    const result = handleDaemonEvent(
      {
        type: 'background_task.started',
        chatId: CHAT_ID,
        task: makeTask({ id: 'b-1', kind: 'bash', description: '', command: 'pnpm dev' }),
      },
      CHAT_ID,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: {
          id: 'b-1',
          kind: 'bash',
          description: 'pnpm dev',
          startedAt: 4200,
          status: 'running',
          toolName: 'Bash',
          command: 'pnpm dev',
          outputPath: '/p/a-1',
        },
      },
    });
  });

  it('a tracker update that learns workflowName/runId projects both into background.upsert', () => {
    const started = handleDaemonEvent(
      { type: 'background_task.started', chatId: CHAT_ID, task: makeTask({ id: 'w-1', kind: 'workflow' }) },
      CHAT_ID,
    );
    expect(started).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: {
          id: 'w-1',
          kind: 'workflow',
          description: 'reviewer subagent',
          startedAt: 4200,
          status: 'running',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
        },
      },
    });

    const updated = handleDaemonEvent(
      {
        type: 'background_task.updated',
        chatId: CHAT_ID,
        task: makeTask({ id: 'w-1', kind: 'workflow', workflowName: 'deploy', runId: 'run_1' }),
      },
      CHAT_ID,
    );
    expect(updated).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: {
          id: 'w-1',
          kind: 'workflow',
          description: 'reviewer subagent',
          startedAt: 4200,
          status: 'running',
          toolName: 'Bash',
          command: '',
          outputPath: '/p/a-1',
          workflowName: 'deploy',
          runId: 'run_1',
        },
      },
    });
  });
});
