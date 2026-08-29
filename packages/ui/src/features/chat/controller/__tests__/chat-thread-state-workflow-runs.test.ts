/**
 * Behavior tests for the workflow-runs slice of the chat-thread reducer.
 * Fixed input events, hardcoded expected state — no production logic re-derived.
 *
 * The seed path moved off the deleted `history.loaded` event: the facade
 * plane has no history-payload frame, so `AcpChatController.attachPlanes()`
 * backfills workflow runs from a dedicated REST read
 * (`getChatWorkflowRuns`) and dispatches `workflow.runs.seeded`.
 */
import { describe, it, expect } from 'vitest';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const CHAT_ID = 'chat-abc';

function workflowRun(taskId: string, overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId,
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe('chat-thread-state — workflow-runs slice', () => {
  it('starts empty', () => {
    expect(createChatThreadState(CHAT_ID).workflowRuns).toEqual({});
  });

  it('workflow.run.updated upserts by taskId', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'workflow.run.updated', run: workflowRun('task-1') });
    expect(s1.workflowRuns).toEqual({ 'task-1': workflowRun('task-1') });
  });

  it('workflow.run.updated replaces an existing run wholesale, not merged field by field', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, {
      type: 'workflow.run.updated',
      run: workflowRun('task-1', { totalTokens: 100, phases: [{ index: 0, title: 'Plan' }] }),
    });
    s = reduceChatThreadState(s, {
      type: 'workflow.run.updated',
      run: workflowRun('task-1', { totalTokens: 500 }),
    });
    // The second run carries no phases — a wholesale replace drops the first run's phases
    // rather than merging them in.
    expect(s.workflowRuns).toEqual({ 'task-1': workflowRun('task-1', { totalTokens: 500 }) });
  });

  it('workflow.run.updated for an unknown taskId inserts it (a run adopted mid-stream)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'workflow.run.updated', run: workflowRun('task-1') });
    s = reduceChatThreadState(s, { type: 'workflow.run.updated', run: workflowRun('task-2', { status: 'completed' }) });
    expect(s.workflowRuns).toEqual({
      'task-1': workflowRun('task-1'),
      'task-2': workflowRun('task-2', { status: 'completed' }),
    });
  });

  it('workflow.run.updated leaves other slices alone', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, {
      type: 'background.upsert',
      task: { id: 'a-1', kind: 'agent', description: 'x', startedAt: 0 },
    });
    s = reduceChatThreadState(s, { type: 'workflow.run.updated', run: workflowRun('task-1') });
    expect(s.backgroundTasks).toEqual({ 'a-1': { id: 'a-1', kind: 'agent', description: 'x', startedAt: 0 } });
  });

  it('workflow.runs.seeded seeds the slice (the REST backfill path)', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, {
      type: 'workflow.runs.seeded',
      runs: [workflowRun('task-1'), workflowRun('task-2', { status: 'completed' })],
    });
    expect(s1.workflowRuns).toEqual({
      'task-1': workflowRun('task-1'),
      'task-2': workflowRun('task-2', { status: 'completed' }),
    });
  });

  it('workflow.runs.seeded replaces rather than merges the slice on a later reload', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'workflow.run.updated', run: workflowRun('stale-task') });
    s = reduceChatThreadState(s, { type: 'workflow.runs.seeded', runs: [workflowRun('task-1')] });
    expect(s.workflowRuns).toEqual({ 'task-1': workflowRun('task-1') });
  });

  it('workflow.runs.seeded with an empty list clears the slice back to empty', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'workflow.run.updated', run: workflowRun('task-1') });
    s = reduceChatThreadState(s, { type: 'workflow.runs.seeded', runs: [] });
    expect(s.workflowRuns).toEqual({});
  });
});
