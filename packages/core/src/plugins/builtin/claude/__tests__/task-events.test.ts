// Path: from __tests__/ → claude/ → builtin/ → plugins/ → src/ → background-tasks/tracker.js (4 ups)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeTaskEvents } from '../task-events.js';
import { BackgroundTaskTracker } from '../../../../background-tasks/tracker.js';

const CTX = { claudeSessionId: 'sess-uuid', realCwd: '/Users/x/proj' };

describe('ClaudeTaskEvents', () => {
  let tracker: BackgroundTaskTracker;
  let te: ClaudeTaskEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new BackgroundTaskTracker();
    te = new ClaudeTaskEvents(tracker);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures Bash run_in_background:true into metadata cache', () => {
    te.captureToolUse('tu-1', {
      name: 'Bash',
      input: { command: 'pnpm dev', description: 'dev', run_in_background: true },
    });
    te.handleTaskStarted('chat-a', { task_id: 't-1', tool_use_id: 'tu-1', description: 'dev' }, CTX);
    expect(tracker.get('chat-a', 't-1')).toMatchObject({
      toolName: 'Bash',
      command: 'pnpm dev',
      description: 'dev',
    });
  });

  it('captures Monitor tool_use', () => {
    te.captureToolUse('tu-2', {
      name: 'Monitor',
      input: { command: 'tail -f /tmp/log', description: 'log tail' },
    });
    te.handleTaskStarted('chat-a', { task_id: 't-2', tool_use_id: 'tu-2', description: 'log tail' }, CTX);
    expect(tracker.get('chat-a', 't-2')!.toolName).toBe('Monitor');
  });

  it('ignores non-background Bash', () => {
    te.captureToolUse('tu-x', { name: 'Bash', input: { command: 'ls' } });
    te.handleTaskStarted('chat-a', { task_id: 't-x', tool_use_id: 'tu-x', description: 'ls listing' }, CTX);
    expect(tracker.get('chat-a', 't-x')).toMatchObject({
      toolName: 'Bash',
      command: 'ls listing', // falls back to description (cache had no entry)
    });
  });

  it('evicts metadata cache after 60s TTL', () => {
    te.captureToolUse('tu-3', { name: 'Bash', input: { command: 'sleep 5', run_in_background: true } });
    vi.advanceTimersByTime(60_001);
    te.handleTaskStarted('chat-a', { task_id: 't-3', tool_use_id: 'tu-3', description: 'sleeper' }, CTX);
    expect(tracker.get('chat-a', 't-3')).toMatchObject({
      toolName: 'Bash',
      command: 'sleeper', // fell back, cache evicted
    });
  });

  it('handles task_notification → tracker.end with all fields', () => {
    te.captureToolUse('tu-4', { name: 'Bash', input: { command: 'gulp build', run_in_background: true } });
    te.handleTaskStarted('chat-a', { task_id: 't-4', tool_use_id: 'tu-4', description: 'build' }, CTX);
    te.handleTaskNotification('chat-a', {
      task_id: 't-4',
      status: 'completed',
      output_file: '/tmp/claude-501/p/s/tasks/t-4.output',
      summary: 'ok',
      usage: { total_tokens: 100, tool_uses: 1, duration_ms: 500 },
    });
    expect(tracker.get('chat-a', 't-4')).toMatchObject({
      status: 'completed',
      outputPath: '/tmp/claude-501/p/s/tasks/t-4.output',
      summary: 'ok',
    });
  });

  it('normalizes empty output_file — preserves deterministic outputPath set at start', () => {
    te.captureToolUse('tu-5', { name: 'Bash', input: { command: 'pnpm dev', run_in_background: true } });
    te.handleTaskStarted('chat-a', { task_id: 't-5', tool_use_id: 'tu-5', description: 'dev' }, CTX);
    // Capture the outputPath that was set at start time.
    const startedPath = tracker.get('chat-a', 't-5')!.outputPath;
    expect(startedPath).toMatch(/t-5\.output$/);
    te.handleTaskNotification('chat-a', {
      task_id: 't-5',
      status: 'stopped',
      output_file: '',
      summary: 'killed',
    });
    // end() with output_file: '' prefers the path set at start — not null.
    expect(tracker.get('chat-a', 't-5')!.outputPath).toBe(startedPath);
  });

  it('maps unknown status to stopped with warning', () => {
    te.captureToolUse('tu-6', { name: 'Bash', input: { command: 'x', run_in_background: true } });
    te.handleTaskStarted('chat-a', { task_id: 't-6', tool_use_id: 'tu-6', description: 'x' }, CTX);
    te.handleTaskNotification('chat-a', {
      task_id: 't-6',
      status: 'aborted' as never,
      output_file: '',
      summary: '',
    });
    expect(tracker.get('chat-a', 't-6')!.status).toBe('stopped');
  });

  it('threads deterministic outputPath into tracker.start', () => {
    const trackerStart = vi.fn();
    const tracker = { start: trackerStart, end: vi.fn() } as unknown as BackgroundTaskTracker;
    const events = new ClaudeTaskEvents(tracker);
    events.handleTaskStarted(
      'chat-a',
      { task_id: 'tkid01', tool_use_id: 'tu1', description: 'd' },
      { claudeSessionId: 'sess-uuid', realCwd: '/Users/x/proj' },
    );
    expect(trackerStart).toHaveBeenCalledTimes(1);
    const args = trackerStart.mock.calls[0]!;
    expect(args[0]).toBe('chat-a');
    expect(args[1]).toMatchObject({ id: 'tkid01' });
    // /tmp on linux/mac; /private/tmp resolution is the caller's job (session.spawn realpaths cwd).
    expect(args[2]).toMatch(/\/claude(-\d+)?\/-Users-x-proj\/sess-uuid\/tasks\/tkid01\.output$/);
  });
});
