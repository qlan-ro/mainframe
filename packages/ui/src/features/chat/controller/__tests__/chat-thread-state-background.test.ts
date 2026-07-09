/**
 * Behavior tests for the background-activity slice of the chat-thread reducer.
 * Fixed input events, hardcoded expected state — no production logic re-derived.
 */
import { describe, it, expect } from 'vitest';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const CHAT_ID = 'chat-abc';

function task(id: string, overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask {
  return { id, kind: 'agent', description: `desc-${id}`, startedAt: 1000, ...overrides };
}

describe('chat-thread-state — background activity slice', () => {
  it('starts empty', () => {
    expect(createChatThreadState(CHAT_ID).backgroundTasks).toEqual({});
  });

  it('background.upsert adds a task', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'background.upsert', task: task('a-1') });
    expect(s1.backgroundTasks).toEqual({
      'a-1': { id: 'a-1', kind: 'agent', description: 'desc-a-1', startedAt: 1000 },
    });
  });

  it('background.upsert replaces an existing task by id (no duplicates)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1', { description: 'renamed' }) });
    expect(Object.keys(s.backgroundTasks)).toEqual(['a-1']);
    expect(s.backgroundTasks['a-1']!.description).toBe('renamed');
  });

  it('background.ended removes the task', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('b-1', { kind: 'bash' }) });
    s = reduceChatThreadState(s, { type: 'background.ended', taskId: 'a-1' });
    expect(s.backgroundTasks).toEqual({
      'b-1': { id: 'b-1', kind: 'bash', description: 'desc-b-1', startedAt: 1000 },
    });
  });

  it('background.ended for an unknown id returns the same state object', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'background.ended', taskId: 'ghost' });
    expect(s1).toBe(s0);
  });

  it('background.snapshot replaces the whole slice', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('stale') });
    s = reduceChatThreadState(s, {
      type: 'background.snapshot',
      tasks: [task('a-1'), task('w-1', { kind: 'workflow' })],
    });
    expect(s.backgroundTasks).toEqual({
      'a-1': { id: 'a-1', kind: 'agent', description: 'desc-a-1', startedAt: 1000 },
      'w-1': { id: 'w-1', kind: 'workflow', description: 'desc-w-1', startedAt: 1000 },
    });
  });

  it('background.snapshot with identical content returns the same state object (no churn)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('a-1')] });
    const s2 = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [task('a-1')] });
    expect(s2).toBe(s);
  });

  it('background.snapshot with an empty list clears the slice', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'background.upsert', task: task('a-1') });
    s = reduceChatThreadState(s, { type: 'background.snapshot', tasks: [] });
    expect(s.backgroundTasks).toEqual({});
  });
});
