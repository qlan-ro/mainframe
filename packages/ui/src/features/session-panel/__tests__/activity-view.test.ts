import { describe, expect, it } from 'vitest';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { activityKind, orderRows, runningCount, runningLabel } from '../activity-view';

const task = (id: string, overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask => ({
  id,
  kind: 'bash',
  description: `task ${id}`,
  startedAt: 1_700_000_000_000,
  ...overrides,
});

describe('runningCount', () => {
  it('is zero for an empty list', () => {
    expect(runningCount([])).toBe(0);
  });

  it('counts a legacy payload with no status as running', () => {
    expect(runningCount([task('a', { kind: 'agent' }), task('b'), task('c', { kind: 'workflow' })])).toBe(3);
  });

  it('counts only running and stopping rows, never terminal ones (AC15)', () => {
    const tasks = [
      task('running', { status: 'running' }),
      task('completed', { status: 'completed', endedAt: 1 }),
      task('failed', { status: 'failed', endedAt: 2 }),
    ];
    expect(runningCount(tasks)).toBe(1);
  });
});

describe('runningLabel', () => {
  it('names the empty state', () => {
    expect(runningLabel(0)).toBe('Nothing running');
  });

  it('is singular at one', () => {
    expect(runningLabel(1)).toBe('1 task running');
  });

  it('is plural above one', () => {
    expect(runningLabel(3)).toBe('3 tasks running');
  });
});

describe('activityKind', () => {
  it('reads bash work started by the Monitor tool as monitor', () => {
    expect(activityKind(task('a', { kind: 'bash', toolName: 'Monitor' }))).toBe('monitor');
  });

  it('reads plain bash work as bash', () => {
    expect(activityKind(task('a', { kind: 'bash', toolName: 'Bash' }))).toBe('bash');
  });

  it('passes every other kind through unchanged', () => {
    expect(activityKind(task('a', { kind: 'agent' }))).toBe('agent');
    expect(activityKind(task('a', { kind: 'workflow' }))).toBe('workflow');
    expect(activityKind(task('a', { kind: 'other' }))).toBe('other');
  });
});

describe('orderRows', () => {
  it('lists running rows first, in start order', () => {
    const tasks = [
      task('later', { status: 'running', startedAt: 200 }),
      task('earlier', { status: 'running', startedAt: 100 }),
    ];
    expect(orderRows(tasks).map((t) => t.id)).toEqual(['earlier', 'later']);
  });

  it('lists terminal rows after running rows, most recently ended first', () => {
    const tasks = [
      task('old', { status: 'completed', endedAt: 100 }),
      task('running', { status: 'running', startedAt: 0 }),
      task('new', { status: 'failed', endedAt: 200 }),
    ];
    expect(orderRows(tasks).map((t) => t.id)).toEqual(['running', 'new', 'old']);
  });
});
