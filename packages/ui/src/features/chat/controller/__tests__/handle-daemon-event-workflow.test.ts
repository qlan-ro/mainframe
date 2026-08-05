/**
 * Behavior tests for handleDaemonEvent — claude_workflow.run.updated mapping.
 * Fixed input events, hardcoded expected HandleResults.
 */
import { describe, it, expect } from 'vitest';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { handleDaemonEvent } from '../handle-daemon-event';

const CHAT_ID = 'chat-abc';
const OTHER_CHAT = 'chat-other';
const EMPTY_MSGS = {} as Readonly<Record<string, unknown>>;

function makeRun(overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId: 'task-1',
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe('handleDaemonEvent — claude_workflow.run.updated', () => {
  it('maps to a workflow.run.updated ChatStateEvent carrying the run verbatim', () => {
    const run = makeRun({ status: 'completed', totalTokens: 900 });
    const result = handleDaemonEvent(
      { type: 'claude_workflow.run.updated', chatId: CHAT_ID, run },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({ kind: 'event', event: { type: 'workflow.run.updated', run } });
  });

  it('for another chat → noop', () => {
    const result = handleDaemonEvent(
      { type: 'claude_workflow.run.updated', chatId: OTHER_CHAT, run: makeRun() },
      CHAT_ID,
      EMPTY_MSGS,
    );
    expect(result).toEqual({ kind: 'noop' });
  });
});
