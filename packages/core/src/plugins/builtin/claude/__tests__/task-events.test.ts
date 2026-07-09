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

  describe('background work kind mapping', () => {
    it('maps local_bash → bash', () => {
      te.handleTaskStarted('chat-a', { task_id: 'b1', description: 'x', task_type: 'local_bash' }, CTX);
      expect(tracker.get('chat-a', 'b1')!.kind).toBe('bash');
    });

    it('maps local_agent → agent', () => {
      te.handleTaskStarted('chat-a', { task_id: 'a1', description: 'x', task_type: 'local_agent' }, CTX);
      expect(tracker.get('chat-a', 'a1')!.kind).toBe('agent');
    });

    it('maps remote agents and teammates → agent', () => {
      te.handleTaskStarted('chat-a', { task_id: 'a2', description: 'x', task_type: 'remote_agent' }, CTX);
      te.handleTaskStarted('chat-a', { task_id: 'a3', description: 'x', task_type: 'teammate' }, CTX);
      expect(tracker.get('chat-a', 'a2')!.kind).toBe('agent');
      expect(tracker.get('chat-a', 'a3')!.kind).toBe('agent');
    });

    it('maps local_workflow → workflow', () => {
      te.handleTaskStarted('chat-a', { task_id: 'w1', description: 'x', task_type: 'local_workflow' }, CTX);
      expect(tracker.get('chat-a', 'w1')!.kind).toBe('workflow');
    });

    it('maps an unknown task_type → other', () => {
      te.handleTaskStarted('chat-a', { task_id: 'o1', description: 'x', task_type: 'local_quantum' }, CTX);
      expect(tracker.get('chat-a', 'o1')!.kind).toBe('other');
    });

    it('falls back to bash when task_type is missing but a Bash tool_use was captured', () => {
      te.captureToolUse('tu-k', { name: 'Bash', input: { command: 'pnpm dev', run_in_background: true } });
      te.handleTaskStarted('chat-a', { task_id: 'k1', tool_use_id: 'tu-k', description: 'dev' }, CTX);
      expect(tracker.get('chat-a', 'k1')!.kind).toBe('bash');
    });

    it('maps missing task_type with no captured tool_use → other', () => {
      te.handleTaskStarted('chat-a', { task_id: 'k2', description: 'x' }, CTX);
      expect(tracker.get('chat-a', 'k2')!.kind).toBe('other');
    });
  });

  describe('handleTaskUpdated', () => {
    it('ends the task on a terminal status', () => {
      te.handleTaskStarted('chat-a', { task_id: 'u1', description: 'x', task_type: 'local_agent' }, CTX);
      te.handleTaskUpdated('chat-a', { task_id: 'u1', status: 'completed' });
      expect(tracker.get('chat-a', 'u1')!.status).toBe('completed');
    });

    it('ignores a non-terminal status (task stays running)', () => {
      te.handleTaskStarted('chat-a', { task_id: 'u2', description: 'x', task_type: 'local_agent' }, CTX);
      te.handleTaskUpdated('chat-a', { task_id: 'u2', status: 'running' });
      expect(tracker.get('chat-a', 'u2')!.status).toBe('running');
    });

    it('ignores an unknown task_id', () => {
      te.handleTaskUpdated('chat-a', { task_id: 'ghost', status: 'completed' });
      expect(tracker.get('chat-a', 'ghost')).toBeNull();
    });
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
