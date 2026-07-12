// packages/core/src/__tests__/automations/schedule-compile.test.ts
import { describe, it, expect } from 'vitest';
import type { SchedulePattern } from '@qlan-ro/mainframe-types';
import { compileSchedule } from '../../automations/triggers/schedule.js';

describe('compileSchedule', () => {
  it('compiles daily to a minute-hour cron pinned to every day', () => {
    expect(compileSchedule({ type: 'daily', at: '21:00' })).toBe('0 21 * * *');
    expect(compileSchedule({ type: 'daily', at: '08:05' })).toBe('5 8 * * *');
  });

  it('compiles weekdays to Mon-Fri only', () => {
    expect(compileSchedule({ type: 'weekdays', at: '09:00' })).toBe('0 9 * * 1-5');
  });

  it('compiles weekly to the given day-of-week list', () => {
    expect(compileSchedule({ type: 'weekly', days: [1, 3, 5], at: '06:00' })).toBe('0 6 * * 1,3,5');
    expect(compileSchedule({ type: 'weekly', days: [0], at: '10:30' })).toBe('30 10 * * 0');
  });

  it('compiles every_n_hours divisors of 24 to a step cron', () => {
    expect(compileSchedule({ type: 'every_n_hours', n: 4 })).toBe('0 */4 * * *');
    expect(compileSchedule({ type: 'every_n_hours', n: 1 })).toBe('0 */1 * * *');
    expect(compileSchedule({ type: 'every_n_hours', n: 24 })).toBe('0 */24 * * *');
  });

  it('rejects every_n_hours values that do not evenly divide 24', () => {
    const bad: SchedulePattern = { type: 'every_n_hours', n: 5 };
    expect(() => compileSchedule(bad)).toThrow(/divide 24/);
  });
});
