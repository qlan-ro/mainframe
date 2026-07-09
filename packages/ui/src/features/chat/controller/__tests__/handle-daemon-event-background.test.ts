/**
 * Behavior tests for handleDaemonEvent — background_task.* mapping.
 * Fixed input events, hardcoded expected HandleResults.
 */
import { describe, it, expect } from 'vitest';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { handleDaemonEvent } from '../handle-daemon-event';

const CHAT_ID = 'chat-abc';
const OTHER_CHAT = 'chat-other';
const EMPTY_MSGS = {} as Readonly<Record<string, unknown>>;

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
  it('started → background.upsert with the projected activity task', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.started', chatId: CHAT_ID, task: makeTask() },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: { id: 'a-1', kind: 'agent', description: 'reviewer subagent', startedAt: 4200 },
      },
    });
  });

  it('started for another chat → noop', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.started', chatId: OTHER_CHAT, task: makeTask() },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({ kind: 'noop' });
  });

  it('updated with running status → background.upsert', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.updated', chatId: CHAT_ID, task: makeTask({ description: 'now longer' }) },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: { id: 'a-1', kind: 'agent', description: 'now longer', startedAt: 4200 },
      },
    });
  });

  it('updated with a terminal status → background.ended', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.updated', chatId: CHAT_ID, task: makeTask({ status: 'completed', endedAt: 5000 }) },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({ kind: 'event', event: { type: 'background.ended', taskId: 'a-1' } });
  });

  it('ended → background.ended', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.ended', chatId: CHAT_ID, task: makeTask({ status: 'stopped', endedAt: 5000 }) },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({ kind: 'event', event: { type: 'background.ended', taskId: 'a-1' } });
  });

  it('started with a non-running status (adopt replay of a finished task) → background.ended', () => {
    const result = handleDaemonEvent(
      { type: 'background_task.started', chatId: CHAT_ID, task: makeTask({ status: 'failed', endedAt: 5000 }) },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({ kind: 'event', event: { type: 'background.ended', taskId: 'a-1' } });
  });

  it('bash task with empty description falls back to the command', () => {
    const result = handleDaemonEvent(
      {
        type: 'background_task.started',
        chatId: CHAT_ID,
        task: makeTask({ id: 'b-1', kind: 'bash', description: '', command: 'pnpm dev' }),
      },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'background.upsert',
        task: { id: 'b-1', kind: 'bash', description: 'pnpm dev', startedAt: 4200 },
      },
    });
  });
});
