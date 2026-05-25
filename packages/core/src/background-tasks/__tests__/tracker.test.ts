import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackgroundTaskTracker } from '../tracker.js';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';

function makeTask(
  overrides: Partial<BackgroundTask> = {},
): Omit<BackgroundTask, 'startedAt' | 'endedAt' | 'status' | 'lastOutputLine' | 'summary' | 'usage' | 'outputPath'> {
  return {
    id: 'task-1',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    command: 'pnpm dev',
    description: 'dev server',
    ...overrides,
  };
}

describe('BackgroundTaskTracker', () => {
  let tracker: BackgroundTaskTracker;
  let events: Array<{ kind: string; chatId: string; task: BackgroundTask }>;

  beforeEach(() => {
    tracker = new BackgroundTaskTracker();
    events = [];
    tracker.on('background_task.started', (chatId, task) => events.push({ kind: 'started', chatId, task }));
    tracker.on('background_task.ended', (chatId, task) => events.push({ kind: 'ended', chatId, task }));
  });

  it('records a started task, lists it by chat, and emits started', () => {
    tracker.start('chat-a', makeTask());
    expect(tracker.list('chat-a')).toHaveLength(1);
    expect(tracker.list('chat-a')[0]!.status).toBe('running');
    expect(events).toEqual([
      { kind: 'started', chatId: 'chat-a', task: expect.objectContaining({ id: 'task-1', status: 'running' }) },
    ]);
  });

  it('transitions to completed and emits ended on terminal status', () => {
    tracker.start('chat-a', makeTask());
    tracker.end('chat-a', 'task-1', {
      status: 'completed',
      outputPath: '/tmp/claude-501/p/s/tasks/task-1.output',
      summary: 'done',
      usage: { totalTokens: 100, toolUses: 1, durationMs: 1000 },
    });
    const t = tracker.get('chat-a', 'task-1')!;
    expect(t.status).toBe('completed');
    expect(t.outputPath).toBe('/tmp/claude-501/p/s/tasks/task-1.output');
    expect(t.endedAt).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ kind: 'ended', chatId: 'chat-a', task: t });
  });

  it('normalizes empty output_file to null on terminal transition', () => {
    tracker.start('chat-a', makeTask());
    tracker.end('chat-a', 'task-1', { status: 'stopped', outputPath: '', summary: 'killed', usage: null });
    expect(tracker.get('chat-a', 'task-1')!.outputPath).toBeNull();
  });

  it('tolerates end without start (drops with no emit)', () => {
    tracker.end('chat-a', 'ghost', { status: 'completed', outputPath: 'x', summary: '', usage: null });
    expect(tracker.list('chat-a')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('dedups terminal status (second end is no-op)', () => {
    tracker.start('chat-a', makeTask());
    tracker.end('chat-a', 'task-1', { status: 'completed', outputPath: 'x', summary: '', usage: null });
    const before = events.length;
    tracker.end('chat-a', 'task-1', { status: 'failed', outputPath: 'y', summary: '', usage: null });
    expect(events.length).toBe(before);
    expect(tracker.get('chat-a', 'task-1')!.status).toBe('completed');
  });

  it('isolates per chat', () => {
    tracker.start('chat-a', makeTask({ id: 'a' }));
    tracker.start('chat-b', makeTask({ id: 'b' }));
    expect(tracker.list('chat-a').map((t) => t.id)).toEqual(['a']);
    expect(tracker.list('chat-b').map((t) => t.id)).toEqual(['b']);
  });

  it('removeChat drops all tasks for that chat', () => {
    tracker.start('chat-a', makeTask());
    tracker.removeChat('chat-a');
    expect(tracker.list('chat-a')).toEqual([]);
  });
});
