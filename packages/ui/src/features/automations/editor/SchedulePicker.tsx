/**
 * SchedulePicker — curated schedules + onMissed run_once/skip toggle (ts153
 * wf2-fields.jsx `WfSchedulePicker`, ported onto the contract's
 * `SchedulePattern` union). Every-N-hours presets are restricted to
 * divisors of 24 (4/6/12) by only ever offering those as curated options —
 * there is no free numeric input to validate against. Preset labels are
 * derived from `summarizeTrigger` rather than hand-duplicated, so this
 * picker and `LibraryRow`'s trigger chips can never drift apart.
 */
import { Switch } from '@/components/ui/switch';
import type { SchedulePattern, ScheduleTrigger } from '../contract';
import { summarizeTrigger } from '../domain/trigger-summary';
import { MiniSelect } from '../fields/MiniSelect';

const SCHEDULE_PRESETS: SchedulePattern[] = [
  { type: 'daily', at: '09:00' },
  { type: 'daily', at: '21:00' },
  { type: 'weekdays', at: '06:00' },
  { type: 'weekdays', at: '09:00' },
  { type: 'weekly', days: [1], at: '09:00' },
  { type: 'every_n_hours', n: 4 },
  { type: 'every_n_hours', n: 6 },
  { type: 'every_n_hours', n: 12 },
];

function labelFor(pattern: SchedulePattern): string {
  return summarizeTrigger({ id: '_', kind: 'schedule', schedule: pattern, onMissed: 'skip' });
}

export interface SchedulePickerProps {
  trigger: ScheduleTrigger;
  onChange: (next: ScheduleTrigger) => void;
  testId: string;
}

export function SchedulePicker({ trigger, onChange, testId }: SchedulePickerProps) {
  const presetOptions = SCHEDULE_PRESETS.map(labelFor);
  const currentLabel = labelFor(trigger.schedule);
  const options = presetOptions.includes(currentLabel) ? presetOptions : [currentLabel, ...presetOptions];

  function handlePick(label: string) {
    const pattern = SCHEDULE_PRESETS.find((p) => labelFor(p) === label);
    if (pattern) onChange({ ...trigger, schedule: pattern });
  }

  return (
    <div className="flex flex-col gap-2">
      <MiniSelect
        value={currentLabel}
        options={options}
        onChange={handlePick}
        testId={`${testId}-preset`}
        width={230}
      />
      <label className="flex items-center gap-2.5">
        <Switch
          data-testid={`${testId}-onmissed`}
          checked={trigger.onMissed === 'run_once'}
          onCheckedChange={(checked) => onChange({ ...trigger, onMissed: checked ? 'run_once' : 'skip' })}
        />
        <span className="text-label text-muted-foreground">
          {trigger.onMissed === 'run_once' ? 'If my Mac was off, run when it starts' : 'Skip missed runs'}
        </span>
      </label>
    </div>
  );
}
