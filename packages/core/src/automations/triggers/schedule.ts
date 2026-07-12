// packages/core/src/automations/triggers/schedule.ts
import type { SchedulePattern } from '@qlan-ro/mainframe-types';

/**
 * Compiles a plain-language SchedulePattern into a cron string, evaluated in
 * local time (contract §7 — cron never crosses the API; the picker only ever
 * shows plain language). `every_n_hours` must evenly divide 24: a step of 5
 * hours resets at midnight instead of firing every 5 hours, so the picker
 * offers only divisors and the schema rejects the rest at the write path —
 * this throws too, defending any caller that bypasses schema validation.
 */
export function compileSchedule(pattern: SchedulePattern): string {
  switch (pattern.type) {
    case 'daily':
      return dailyCron(pattern.at, '*');
    case 'weekdays':
      return dailyCron(pattern.at, '1-5');
    case 'weekly':
      return dailyCron(pattern.at, pattern.days.join(','));
    case 'every_n_hours':
      if (24 % pattern.n !== 0) {
        throw new Error(`every_n_hours 'n' (${pattern.n}) must evenly divide 24`);
      }
      return `0 */${pattern.n} * * *`;
  }
}

function dailyCron(at: string, weekday: string): string {
  const [hour, minute] = at.split(':').map(Number);
  return `${minute} ${hour} * * ${weekday}`;
}
