/**
 * Human-readable one-line summary for a trigger row (`editor/TriggerRow.tsx`,
 * Phase 3; `library/LibraryRow.tsx`'s trigger chips, Phase 1).
 */
import type { AutomationEventName, AutomationTrigger, SchedulePattern } from '../contract';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function summarizeSchedule(schedule: SchedulePattern): string {
  switch (schedule.type) {
    case 'daily':
      return `Every day at ${schedule.at}`;
    case 'weekdays':
      return `Weekdays at ${schedule.at}`;
    case 'weekly': {
      const days = schedule.days.map((d) => WEEKDAY_NAMES[d] ?? String(d)).join(', ');
      return `Every ${days} at ${schedule.at}`;
    }
    case 'every_n_hours':
      return `Every ${schedule.n} hour${schedule.n === 1 ? '' : 's'}`;
  }
}

const EVENT_SUMMARY: Record<AutomationEventName, string> = {
  'session.finished': 'When a chat session finishes',
  'automation.finished': 'When another automation finishes',
  'automation.failed': 'When another automation fails',
};

export function summarizeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case 'schedule':
      return summarizeSchedule(trigger.schedule);
    case 'event':
      return EVENT_SUMMARY[trigger.event];
    case 'webhook':
      return 'Webhook';
  }
}
