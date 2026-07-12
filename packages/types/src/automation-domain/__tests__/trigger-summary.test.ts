import { describe, expect, it } from 'vitest';
import { summarizeTrigger } from '../trigger-summary.js';

describe('summarizeTrigger', () => {
  it('summarizes a daily schedule', () => {
    expect(
      summarizeTrigger({ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '21:00' }, onMissed: 'skip' }),
    ).toBe('Every day at 21:00');
  });

  it('summarizes a weekdays schedule', () => {
    expect(
      summarizeTrigger({
        id: 't1',
        kind: 'schedule',
        schedule: { type: 'weekdays', at: '06:00' },
        onMissed: 'run_once',
      }),
    ).toBe('Weekdays at 06:00');
  });

  it('summarizes an every-N-hours schedule', () => {
    expect(
      summarizeTrigger({ id: 't1', kind: 'schedule', schedule: { type: 'every_n_hours', n: 4 }, onMissed: 'skip' }),
    ).toBe('Every 4 hours');
  });

  it('summarizes a curated event trigger', () => {
    expect(summarizeTrigger({ id: 't1', kind: 'event', event: 'session.finished' })).toBe(
      'When a chat session finishes',
    );
    expect(summarizeTrigger({ id: 't1', kind: 'event', event: 'automation.finished' })).toBe(
      'When another automation finishes',
    );
    expect(summarizeTrigger({ id: 't1', kind: 'event', event: 'automation.failed' })).toBe(
      'When another automation fails',
    );
  });

  it('summarizes a webhook trigger', () => {
    expect(summarizeTrigger({ id: 't1', kind: 'webhook', hookId: 'abc123' })).toBe('Webhook');
  });
});
