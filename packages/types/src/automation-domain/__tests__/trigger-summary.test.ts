import { describe, expect, it } from 'vitest';
import { summarizeTrigger } from '../trigger-summary.js';

describe('summarizeTrigger', () => {
  it.each([
    [
      'daily schedule',
      { id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '21:00' }, onMissed: 'skip' },
      'Every day at 21:00',
    ],
    [
      'weekdays schedule',
      { id: 't1', kind: 'schedule', schedule: { type: 'weekdays', at: '06:00' }, onMissed: 'run_once' },
      'Weekdays at 06:00',
    ],
    [
      'every-N-hours schedule',
      { id: 't1', kind: 'schedule', schedule: { type: 'every_n_hours', n: 4 }, onMissed: 'skip' },
      'Every 4 hours',
    ],
    [
      'curated event: session.finished',
      { id: 't1', kind: 'event', event: 'session.finished' },
      'When a chat session finishes',
    ],
    [
      'curated event: automation.finished',
      { id: 't1', kind: 'event', event: 'automation.finished' },
      'When another automation finishes',
    ],
    [
      'curated event: automation.failed',
      { id: 't1', kind: 'event', event: 'automation.failed' },
      'When another automation fails',
    ],
    ['webhook trigger', { id: 't1', kind: 'webhook', hookId: 'abc123' }, 'Webhook'],
  ] as const)('summarizes %s', (_label, trigger, expected) => {
    expect(summarizeTrigger(trigger)).toBe(expected);
  });
});
