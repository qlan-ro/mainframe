import { describe, expect, it } from 'vitest';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { ACTIVITY_KIND_ICON, activityLabel, rowState, statusLabel, statusTone } from '../activity-kinds';

const task = (overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask => ({
  id: 'a',
  kind: 'bash',
  description: 'task a',
  startedAt: 0,
  ...overrides,
});

describe('ACTIVITY_KIND_ICON', () => {
  it('is pairwise distinct across Monitor, Task, Agent, Workflow and unrecognised (AC16)', () => {
    const icons = Object.values(ACTIVITY_KIND_ICON);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('activityLabel', () => {
  it('labels Monitor-tool bash work "Monitor"', () => {
    expect(activityLabel(task({ toolName: 'Monitor' }))).toBe('Monitor');
  });

  it('labels a plain background shell command "Task"', () => {
    expect(activityLabel(task({ toolName: 'Bash' }))).toBe('Task');
  });

  it('labels agent and workflow rows unchanged', () => {
    expect(activityLabel(task({ kind: 'agent' }))).toBe('Agent');
    expect(activityLabel(task({ kind: 'workflow' }))).toBe('Workflow');
  });

  it('labels an unrecognised task with its reported type (AC17)', () => {
    expect(activityLabel(task({ kind: 'other', reportedType: 'container_exec' }))).toBe('container_exec');
  });

  it('falls back to "Task" when no reported type is present', () => {
    expect(activityLabel(task({ kind: 'other' }))).toBe('Task');
  });
});

describe('statusLabel / statusTone', () => {
  it('names each terminal status', () => {
    expect(statusLabel('completed')).toBe('Completed');
    expect(statusLabel('failed')).toBe('Failed');
    expect(statusLabel('stopped')).toBe('Stopped');
  });

  it('tones success/destructive/muted', () => {
    expect(statusTone('completed')).toBe('text-success');
    expect(statusTone('failed')).toBe('text-destructive');
    expect(statusTone('stopped')).toBe('text-muted-foreground');
  });
});

describe('rowState', () => {
  it('is running with no status and no stop state', () => {
    expect(rowState(task(), undefined)).toBe('running');
  });

  it('is stopping while a stop is in flight', () => {
    expect(rowState(task({ status: 'running' }), { phase: 'stopping' })).toBe('stopping');
  });

  it('is stop-error when the stop failed', () => {
    expect(rowState(task({ status: 'running' }), { phase: 'error', message: 'nope' })).toBe('stop-error');
  });

  it('lets a terminal status win over a stale stop state', () => {
    expect(rowState(task({ status: 'completed' }), { phase: 'stopping' })).toBe('completed');
  });
});
