import { describe, expect, it } from 'vitest';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import type { ActivityEntry } from '../activity-model';
import { activityStatus, groupActivity } from '../activity-status';

const MINUTE = 60_000;
const now = 100 * MINUTE;
const row = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'r',
  kind: 'subagent',
  title: 'Review',
  detail: '',
  state: 'running',
  startedAt: 96 * MINUTE,
  ...overrides,
});

describe('activityStatus', () => {
  it('reads running work as its elapsed time', () => {
    expect(activityStatus(row(), now)).toEqual({ tone: 'running', text: '4m' });
  });

  it('reads a running workflow as the phase it reached', () => {
    const run = {
      status: 'running',
      phases: [
        { index: 1, title: 'Lint' },
        { index: 2, title: 'Typecheck' },
        { index: 3, title: 'Test' },
      ],
      agents: [
        { phaseIndex: 1, state: 'done', durationMs: 1 },
        { phaseIndex: 2, state: 'progress', durationMs: 1 },
      ],
    } as unknown as ClaudeWorkflowRun;
    expect(activityStatus(row({ kind: 'workflow' }), now, run).text).toBe('phase 2 of 3');
  });

  it.each([
    ['needs-you', 'needs-you', 'needs you'],
    ['failed', 'failed', 'failed'],
    ['queued', 'plain', 'queued'],
    ['stopped', 'plain', 'stopped'],
    ['removed', 'plain', 'removed'],
  ] as const)('%s reads "%s" text in plain words', (state, tone, text) => {
    expect(activityStatus(row({ state }), now)).toEqual({ tone, text });
  });

  it('reads a schedule as its next run, its recurrence, or due', () => {
    const scheduled = (extra: Partial<ActivityEntry>) =>
      activityStatus(row({ kind: 'scheduled', state: 'scheduled', ...extra }), now).text;
    expect(scheduled({ nextAt: now + 20 * MINUTE })).toBe('in 20m');
    expect(scheduled({ nextAt: now - MINUTE })).toBe('due');
    expect(scheduled({ nextAt: now + MINUTE, recurring: true })).toBe('recurring');
    expect(scheduled({})).toBe('scheduled');
  });

  it('reads finished work as the time it ended', () => {
    const endedAt = new Date(2026, 10, 24, 9, 31).getTime();
    expect(activityStatus(row({ state: 'completed', endedAt }), now).text).toMatch(/9:31/);
  });
});

describe('groupActivity', () => {
  it('puts ongoing work needs-you first, and finished work under Earlier, latest first', () => {
    const groups = groupActivity([
      row({ id: 'scheduled', state: 'scheduled' }),
      row({ id: 'old', state: 'completed', endedAt: 1 }),
      row({ id: 'queued', state: 'queued' }),
      row({ id: 'running' }),
      row({ id: 'new', state: 'failed', endedAt: 2 }),
      row({ id: 'needs', state: 'needs-you' }),
    ]);
    expect(groups.ongoing.map((entry) => entry.id)).toEqual(['needs', 'running', 'queued', 'scheduled']);
    expect(groups.earlier.map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(groups.failed).toBe(1);
  });
});
