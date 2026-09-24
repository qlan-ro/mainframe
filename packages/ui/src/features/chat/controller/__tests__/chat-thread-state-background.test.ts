/**
 * Behavior tests for the background-activity slice of the chat-thread reducer.
 * Fixed input events, hardcoded expected state — no production logic re-derived.
 */
import { describe, it, expect } from 'vitest';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const CHAT_ID = 'chat-abc';

function task(id: string, overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask {
  return { id, kind: 'agent', description: `desc-${id}`, startedAt: 1000, status: 'running', ...overrides };
}

function terminal(id: string, overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask {
  return task(id, { status: 'completed', endedAt: 2000, ...overrides });
}

describe('chat-thread-state — background activity slice', () => {
  it('starts empty', () => {
    const s = createChatThreadState(CHAT_ID);
    expect(s.backgroundTasks).toEqual({});
    expect(s.backgroundStops).toEqual({});
  });

  it('background.upsert adds a task', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'background.upsert', task: task('a-1') });
    expect(s1.backgroundTasks).toEqual({ 'a-1': task('a-1') });
  });

  it('background.upsert replaces an existing task by id (no duplicates)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1', { description: 'renamed' }) });
    expect(Object.keys(s.backgroundTasks)).toEqual(['a-1']);
    expect(s.backgroundTasks['a-1']!.description).toBe('renamed');
  });

  it('background.ended settles a listed task into a terminal row (AC14: retained, not removed)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('b-1', { kind: 'bash' }) });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1') });
    expect(s.backgroundTasks).toEqual({
      'a-1': terminal('a-1'),
      'b-1': task('b-1', { kind: 'bash' }),
    });
  });

  it('background.ended for a task never listed is a no-op (AC14)', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'background.ended', task: terminal('ghost') });
    expect(s1).toBe(s0);
    expect(s1.backgroundTasks).toEqual({});
  });

  it('background.ended clears any stop state for that task (AC14)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    expect(s.backgroundStops).toEqual({ 'a-1': { phase: 'stopping' } });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1', { status: 'stopped' }) });
    expect(s.backgroundStops).toEqual({});
  });

  it('background.ended enforces a cap of 5 terminal rows, dropping the smallest endedAt first (AC14)', () => {
    let s = createChatThreadState(CHAT_ID);
    for (let i = 1; i <= 5; i++) {
      s = reduceChatThreadState(s, { type: 'background.upsert', task: task(`t-${i}`) });
      s = reduceChatThreadState(s, { type: 'background.ended', task: terminal(`t-${i}`, { endedAt: 1000 + i }) });
    }
    expect(Object.keys(s.backgroundTasks).sort()).toEqual(['t-1', 't-2', 't-3', 't-4', 't-5']);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('t-6') });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('t-6', { endedAt: 1006 }) });
    expect(Object.keys(s.backgroundTasks).sort()).toEqual(['t-2', 't-3', 't-4', 't-5', 't-6']);
  });

  it('background.snapshot replaces the running slice', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('stale') });
    s = reduceChatThreadState(s, {
      type: 'background.snapshot',
      tasks: [task('a-1'), task('w-1', { kind: 'workflow' })],
    });
    expect(s.backgroundTasks).toEqual({
      'a-1': task('a-1'),
      'w-1': task('w-1', { kind: 'workflow' }),
    });
  });

  it('background.snapshot keeps every terminal entry (AC14)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1') });
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('b-1')] });
    expect(s.backgroundTasks).toEqual({
      'a-1': terminal('a-1'),
      'b-1': task('b-1'),
    });
  });

  it('background.snapshot never overrides an already-terminal row with a stale running one', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1') });
    // A late chat.updated snapshot still lists 'a-1' as running (a race with `ended`).
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('a-1')] });
    expect(s.backgroundTasks['a-1']).toEqual(terminal('a-1'));
  });

  it('background.snapshot with identical content returns the same state object (no churn)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('a-1')] });
    const s2 = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('a-1')] });
    expect(s2).toBe(s);
  });

  it('background.snapshot that learns workflowName/runId on reconnect is NOT treated as equal', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('w-1', { kind: 'workflow' })] });
    const s2 = reduceChatThreadState(s, {
      type: 'background.snapshot',
      tasks: [task('w-1', { kind: 'workflow', workflowName: 'deploy', runId: 'run_1' })],
    });
    expect(s2).not.toBe(s);
    expect(s2.backgroundTasks['w-1']).toEqual(
      task('w-1', { kind: 'workflow', workflowName: 'deploy', runId: 'run_1' }),
    );
  });

  it('a field-identical snapshot after that learned identity returns the same state object', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('w-1', { kind: 'workflow' })] });
    s = reduceChatThreadState(s, {
      type: 'background.snapshot',
      tasks: [task('w-1', { kind: 'workflow', workflowName: 'deploy', runId: 'run_1' })],
    });
    const s2 = reduceChatThreadState(s, {
      type: 'background.snapshot',
      tasks: [task('w-1', { kind: 'workflow', workflowName: 'deploy', runId: 'run_1' })],
    });
    expect(s2).toBe(s);
  });

  it('background.snapshot with an empty list clears the running slice (terminal rows survive)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [] });
    expect(s.backgroundTasks).toEqual({});
  });

  it('background.snapshot prunes stop state for a running row the snapshot drops', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [] });
    expect(s.backgroundStops).toEqual({});
  });

  it('background.snapshot keeps a stopping phase across a snapshot that still lists the task', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('a-1')] });
    expect(s.backgroundStops).toEqual({ 'a-1': { phase: 'stopping' } });
  });

  it('background.dismissed removes a terminal row', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1') });
    s = reduceChatThreadState(s, { type: 'background.dismissed', taskId: 'a-1' });
    expect(s.backgroundTasks).toEqual({});
  });

  it('background.dismissed is a no-op on a running row', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    const s2 = reduceChatThreadState(s, { type: 'background.dismissed', taskId: 'a-1' });
    expect(s2).toBe(s);
    expect(s2.backgroundTasks).toEqual({ 'a-1': task('a-1') });
  });

  it('background.turn.started clears every terminal row and leaves running rows alone', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('b-1') });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('b-1') });
    s = reduceChatThreadState(s, { type: 'background.turn.started' });
    expect(s.backgroundTasks).toEqual({ 'a-1': task('a-1') });
  });

  it('background.turn.started is identity-stable when there is nothing terminal', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    const s2 = reduceChatThreadState(s, { type: 'background.turn.started' });
    expect(s2).toBe(s);
  });

  it('background.stop.requested sets stopping only for a listed running row', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    expect(s.backgroundStops).toEqual({ 'a-1': { phase: 'stopping' } });
  });

  it('background.stop.requested is a no-op for an absent or terminal row', () => {
    let s = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'ghost' });
    expect(s1).toBe(s);

    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1') });
    const s2 = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    expect(s2).toBe(s);
    expect(s2.backgroundStops).toEqual({});
  });

  it('background.stop.failed sets an error and is ignored on a terminal or absent row', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    s = reduceChatThreadState(s, { type: 'background.stop.failed', taskId: 'a-1', message: 'boom' });
    expect(s.backgroundStops).toEqual({ 'a-1': { phase: 'error', message: 'boom' } });

    // A late failure must never revert an already-terminal row.
    s = reduceChatThreadState(s, { type: 'background.ended', task: terminal('a-1') });
    const s2 = reduceChatThreadState(s, { type: 'background.stop.failed', taskId: 'a-1', message: 'too late' });
    expect(s2).toBe(s);
    expect(s2.backgroundStops).toEqual({});
  });

  it('background.removed deletes the row and its stop state', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.stop.requested', taskId: 'a-1' });
    s = reduceChatThreadState(s, { type: 'background.removed', taskId: 'a-1' });
    expect(s.backgroundTasks).toEqual({});
    expect(s.backgroundStops).toEqual({});
  });

  it('background.removed for an unlisted id returns the same state object', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'background.removed', taskId: 'ghost' });
    expect(s1).toBe(s0);
  });
});
