import { describe, it, expect, beforeEach } from 'vitest';
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
    tracker.start('chat-a', makeTask(), '/tmp/spool/task-1.output');
    expect(tracker.list('chat-a')).toHaveLength(1);
    expect(tracker.list('chat-a')[0]!.status).toBe('running');
    expect(events).toEqual([
      { kind: 'started', chatId: 'chat-a', task: expect.objectContaining({ id: 'task-1', status: 'running' }) },
    ]);
  });

  it('transitions to completed and emits ended on terminal status', () => {
    tracker.start('chat-a', makeTask(), '/tmp/spool/task-1.output');
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

  it('preserves start-time outputPath when end sends empty string', () => {
    tracker.start('chat-a', makeTask(), '/tmp/spool/task-1.output');
    tracker.end('chat-a', 'task-1', { status: 'stopped', outputPath: '', summary: 'killed', usage: null });
    expect(tracker.get('chat-a', 'task-1')!.outputPath).toBe('/tmp/spool/task-1.output');
  });

  it('tolerates end without start (drops with no emit)', () => {
    tracker.end('chat-a', 'ghost', { status: 'completed', outputPath: 'x', summary: '', usage: null });
    expect(tracker.list('chat-a')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('dedups terminal status (second end is no-op)', () => {
    tracker.start('chat-a', makeTask(), '/tmp/spool/task-1.output');
    tracker.end('chat-a', 'task-1', { status: 'completed', outputPath: 'x', summary: '', usage: null });
    const before = events.length;
    tracker.end('chat-a', 'task-1', { status: 'failed', outputPath: 'y', summary: '', usage: null });
    expect(events.length).toBe(before);
    expect(tracker.get('chat-a', 'task-1')!.status).toBe('completed');
  });

  it('isolates per chat', () => {
    tracker.start('chat-a', makeTask({ id: 'a' }), '/tmp/spool/a.output');
    tracker.start('chat-b', makeTask({ id: 'b' }), '/tmp/spool/b.output');
    expect(tracker.list('chat-a').map((t) => t.id)).toEqual(['a']);
    expect(tracker.list('chat-b').map((t) => t.id)).toEqual(['b']);
  });

  it('removeChat drops all tasks for that chat', () => {
    tracker.start('chat-a', makeTask(), '/tmp/spool/task-1.output');
    tracker.removeChat('chat-a');
    expect(tracker.list('chat-a')).toEqual([]);
  });

  describe('adopt (reconciliation)', () => {
    it('inserts a fully-formed task without emitting started/ended', () => {
      const local: { kind: string }[] = [];
      tracker.on('background_task.started', () => local.push({ kind: 'started' }));
      tracker.on('background_task.ended', () => local.push({ kind: 'ended' }));
      tracker.adopt('chat-a', {
        id: 'rec-1',
        toolName: 'Bash',
        toolUseId: '',
        command: '<recovered>',
        description: '',
        outputPath: '/tmp/claude-501/-x/sess/tasks/rec-1.output',
        startedAt: 1000,
        endedAt: null,
        status: 'running',
        lastOutputLine: null,
        summary: null,
        usage: null,
        recovered: true,
      });
      expect(tracker.list('chat-a')).toHaveLength(1);
      expect(tracker.get('chat-a', 'rec-1')!.recovered).toBe(true);
      expect(tracker.get('chat-a', 'rec-1')!.startedAt).toBe(1000);
      expect(local).toEqual([]);
    });

    it('replaces an existing entry on adopt', () => {
      tracker.adopt('chat-a', {
        id: 'rec-1',
        toolName: 'Bash',
        toolUseId: '',
        command: 'a',
        description: '',
        outputPath: '/p1',
        startedAt: 1,
        endedAt: null,
        status: 'running',
        lastOutputLine: null,
        summary: null,
        usage: null,
        recovered: true,
      });
      tracker.adopt('chat-a', {
        id: 'rec-1',
        toolName: 'Bash',
        toolUseId: '',
        command: 'b',
        description: '',
        outputPath: '/p2',
        startedAt: 2,
        endedAt: 3,
        status: 'stopped',
        lastOutputLine: null,
        summary: 'gone',
        usage: null,
        recovered: true,
      });
      expect(tracker.get('chat-a', 'rec-1')!.outputPath).toBe('/p2');
      expect(tracker.get('chat-a', 'rec-1')!.status).toBe('stopped');
    });
  });

  describe('listAllRunning', () => {
    it('returns every running task across all chats with the chatId attached', () => {
      tracker.start('chat-a', { id: 't1', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' }, '/p/a-t1');
      tracker.start('chat-a', { id: 't2', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' }, '/p/a-t2');
      tracker.start('chat-b', { id: 't1', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' }, '/p/b-t1');
      tracker.end('chat-a', 't2', { status: 'completed', outputPath: '/p/a-t2', summary: '', usage: null });
      const all = tracker
        .listAllRunning()
        .map((e) => `${e.chatId}/${e.task.id}`)
        .sort();
      expect(all).toEqual(['chat-a/t1', 'chat-b/t1']);
    });
  });

  describe('pid map (chat-scoped, private)', () => {
    it('stores and reads pids per (chatId, taskId)', () => {
      tracker.start(
        'chat-a',
        { id: 't1', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' },
        '/p/t1.out',
      );
      tracker.start(
        'chat-b',
        { id: 't1', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' },
        '/p/t1.out',
      );
      tracker.setPid('chat-a', 't1', 111);
      tracker.setPid('chat-b', 't1', 222);
      expect(tracker.getPid('chat-a', 't1')).toBe(111);
      expect(tracker.getPid('chat-b', 't1')).toBe(222);
      expect(tracker.getPid('chat-a', 'missing')).toBeNull();
    });

    it('removeChat clears the pid map slice for that chat', () => {
      tracker.start(
        'chat-a',
        { id: 't1', toolName: 'Bash', toolUseId: 'u', command: 'x', description: '' },
        '/p/t1.out',
      );
      tracker.setPid('chat-a', 't1', 111);
      tracker.removeChat('chat-a');
      expect(tracker.getPid('chat-a', 't1')).toBeNull();
    });
  });

  describe('start(outputPath)', () => {
    it('stamps the deterministic outputPath at start time', () => {
      tracker.start(
        'chat-a',
        { id: 't9', toolName: 'Bash', toolUseId: 'u9', command: 'pnpm dev', description: 'dev server' },
        '/tmp/claude-501/-Users-x-proj/sess/tasks/t9.output',
      );
      expect(tracker.get('chat-a', 't9')!.outputPath).toBe('/tmp/claude-501/-Users-x-proj/sess/tasks/t9.output');
    });
  });
});
