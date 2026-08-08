/**
 * SchedulePicker — preset / custom / one-off schedules + the onMissed
 * run_once/skip toggle (ts153 wf2-fields.jsx `WfSchedulePicker`, ported onto
 * the contract's `SchedulePattern` union). Every-N-hours patterns are only
 * ever reachable through the curated presets (divisors of 24: 4/6/12) —
 * there is no free numeric input to validate against, which is why the
 * custom editor offers daily/weekdays/weekly only. Preset and summary labels
 * both come from `summarizeTrigger`, so this picker and `LibraryRow`'s
 * trigger chips can never drift apart.
 *
 * Mode is local state, not a derived value: a pattern doesn't say which
 * editor authored it, and switching modes must be able to show an empty
 * one-off field without first destroying the recurring pattern in the draft.
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { SchedulePattern, ScheduleTrigger } from '../contract';
import { summarizeTrigger } from '../domain/trigger-summary';
import { SegmentedControl } from '../parts/SegmentedControl';

type Mode = 'preset' | 'custom' | 'once';
type RecurringPattern = Extract<SchedulePattern, { type: 'daily' | 'weekdays' | 'weekly' }>;

const DEFAULT_TIME = '09:00';
const DEFAULT_PRESET: SchedulePattern = { type: 'daily', at: DEFAULT_TIME };

const SCHEDULE_PRESETS: SchedulePattern[] = [
  DEFAULT_PRESET,
  { type: 'daily', at: '21:00' },
  { type: 'weekdays', at: '06:00' },
  { type: 'weekdays', at: DEFAULT_TIME },
  { type: 'weekly', days: [1], at: DEFAULT_TIME },
  { type: 'every_n_hours', n: 4 },
  { type: 'every_n_hours', n: 6 },
  { type: 'every_n_hours', n: 12 },
];

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'preset', label: 'Preset' },
  { value: 'custom', label: 'Custom' },
  { value: 'once', label: 'One-off' },
];

const FREQUENCIES: Array<{ value: RecurringPattern['type']; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function labelFor(pattern: SchedulePattern): string {
  return summarizeTrigger({ id: '_', kind: 'schedule', schedule: pattern, onMissed: 'skip' });
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Stable identity for a pattern — the preset select's value, each option's
 * React key, and its testid. Derived from the pattern's own fields, never from
 * `labelFor`: rendered prose is a translation and a wording change away from
 * silently rekeying every option.
 */
function patternId(pattern: SchedulePattern): string {
  switch (pattern.type) {
    case 'every_n_hours':
      return `every-${pattern.n}-hours`;
    case 'weekly':
      return slug(`weekly-${pattern.days.join('-')}-${pattern.at}`);
    case 'once':
      return slug(`once-${pattern.at}`);
    case 'daily':
    case 'weekdays':
      return slug(`${pattern.type}-${pattern.at}`);
  }
}

function toCustom(pattern: SchedulePattern): RecurringPattern {
  switch (pattern.type) {
    case 'daily':
    case 'weekdays':
    case 'weekly':
      return pattern;
    case 'every_n_hours':
      return { type: 'daily', at: DEFAULT_TIME };
    case 'once':
      return { type: 'daily', at: pattern.at.split('T')[1] || DEFAULT_TIME };
  }
}

function deriveMode(pattern: SchedulePattern): Mode {
  if (pattern.type === 'once') return 'once';
  // The custom editor can't express every-N-hours; the preset select carries
  // even a non-curated N as its own option.
  if (pattern.type === 'every_n_hours') return 'preset';
  return SCHEDULE_PRESETS.some((p) => patternId(p) === patternId(pattern)) ? 'preset' : 'custom';
}

function CustomSchedule({
  pattern,
  onChange,
  testId,
}: {
  pattern: RecurringPattern;
  onChange: (next: RecurringPattern) => void;
  testId: string;
}) {
  function handleFrequency(next: RecurringPattern['type']) {
    if (next === pattern.type) return;
    if (next === 'weekly') {
      onChange({ type: 'weekly', days: [1], at: pattern.at });
      return;
    }
    onChange({ type: next, at: pattern.at });
  }

  function toggleDay(day: number) {
    if (pattern.type !== 'weekly') return;
    const days = pattern.days.includes(day)
      ? pattern.days.filter((d) => d !== day)
      : [...pattern.days, day].sort((a, b) => a - b);
    // A weekly schedule with no day would never fire.
    if (days.length === 0) return;
    onChange({ ...pattern, days });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={pattern.type} onValueChange={(next) => handleFrequency(next as RecurringPattern['type'])}>
        <SelectTrigger data-testid={`${testId}-frequency`} className="h-[28px] w-[124px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FREQUENCIES.map((frequency) => (
            <SelectItem
              key={frequency.value}
              value={frequency.value}
              data-testid={`${testId}-frequency-option-${frequency.value}`}
            >
              {frequency.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pattern.type === 'weekly' && (
        <div className="flex gap-1">
          {WEEKDAYS.map((name, day) => {
            const active = pattern.days.includes(day);
            return (
              <button
                key={name}
                type="button"
                data-testid={`${testId}-day-${day}`}
                aria-pressed={active}
                onClick={() => toggleDay(day)}
                className={cn(
                  'h-[28px] w-[34px] rounded-md border-[0.5px] text-xs font-medium',
                  active
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      <Input
        type="time"
        data-testid={`${testId}-at`}
        value={pattern.at}
        // An empty field is a half-typed time, not a schedule — keep the last
        // valid one rather than writing `at: ''`, which saves and never fires.
        onChange={(e) => e.target.value && onChange({ ...pattern, at: e.target.value })}
        className="h-[28px] w-[108px] px-2.5 py-0 text-xs"
      />
    </div>
  );
}

export interface SchedulePickerProps {
  trigger: ScheduleTrigger;
  onChange: (next: ScheduleTrigger) => void;
  testId: string;
}

export function SchedulePicker({ trigger, onChange, testId }: SchedulePickerProps) {
  const [mode, setMode] = useState<Mode>(() => deriveMode(trigger.schedule));
  const pattern = trigger.schedule;

  function emit(schedule: SchedulePattern) {
    onChange({ ...trigger, schedule });
  }

  function handleMode(next: Mode) {
    setMode(next);
    if (next === 'preset' && pattern.type === 'once') emit(DEFAULT_PRESET);
    if (next === 'custom' && (pattern.type === 'once' || pattern.type === 'every_n_hours')) emit(toCustom(pattern));
    // Switching to one-off emits nothing: the datetime field starts empty and
    // the recurring pattern survives until the user actually picks a moment.
  }

  const currentId = patternId(pattern);
  const presetOptions = SCHEDULE_PRESETS.map((p) => ({ id: patternId(p), label: labelFor(p) }));
  // A saved pattern the curated list doesn't offer still needs an option to select.
  const options = presetOptions.some((o) => o.id === currentId)
    ? presetOptions
    : [{ id: currentId, label: labelFor(pattern) }, ...presetOptions];
  const summary =
    mode === 'custom'
      ? labelFor(toCustom(pattern))
      : mode === 'once' && pattern.type === 'once'
        ? labelFor(pattern)
        : null;

  return (
    <div className="flex flex-col gap-[9px]">
      <SegmentedControl
        options={MODES}
        value={mode}
        onChange={handleMode}
        testIdPrefix={`${testId}-mode`}
        label="Schedule mode"
      />

      {mode === 'preset' && (
        <Select
          value={currentId}
          onValueChange={(id) => {
            const picked = SCHEDULE_PRESETS.find((p) => patternId(p) === id);
            if (picked) emit(picked);
          }}
        >
          <SelectTrigger data-testid={`${testId}-preset`} className="h-[28px] w-[230px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id} data-testid={`${testId}-preset-option-${option.id}`}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {mode === 'custom' && <CustomSchedule pattern={toCustom(pattern)} onChange={emit} testId={testId} />}

      {mode === 'once' && (
        <Input
          type="datetime-local"
          data-testid={`${testId}-once-at`}
          value={pattern.type === 'once' ? pattern.at : ''}
          // An empty field is a half-typed datetime, not a schedule — keep the
          // last valid moment rather than writing `at: ''` into the draft.
          onChange={(e) => e.target.value && emit({ type: 'once', at: e.target.value })}
          className="h-[28px] w-[200px] px-2.5 py-0 text-xs"
        />
      )}

      {summary && (
        <span data-testid={`${testId}-summary`} className="text-xs text-muted-foreground">
          {summary}
        </span>
      )}

      <label className="flex items-center gap-2.5">
        <Switch
          data-testid={`${testId}-onmissed`}
          checked={trigger.onMissed === 'run_once'}
          onCheckedChange={(checked) => onChange({ ...trigger, onMissed: checked ? 'run_once' : 'skip' })}
        />
        <span className="text-xs text-muted-foreground">
          {trigger.onMissed === 'run_once' ? 'If my Mac was off, run when it starts' : 'Skip missed runs'}
        </span>
      </label>
    </div>
  );
}
