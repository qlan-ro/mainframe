/**
 * SchedulePicker — preset / custom / one-off modes + the onMissed
 * run_once/skip toggle (ts153 wf2-fields.jsx `WfSchedulePicker`, extended in
 * todo #234 T18 with the custom and one-off modes). Curated every-N-hours
 * presets are restricted to divisors of 24 by construction (4/6/12) — there
 * is no free numeric input to validate. TDD: test written first,
 * implemented after.
 *
 * `<input type="time">` / `<input type="datetime-local">` are driven with
 * `fireEvent.change`: userEvent types into the rendered segments, which jsdom
 * does not implement.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduleTrigger } from '../../contract';
import { SchedulePicker } from '../SchedulePicker';

function schedule(overrides: Partial<ScheduleTrigger> = {}): ScheduleTrigger {
  return { id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip', ...overrides };
}

/** The shared select is a portalled popover — its options only exist once the trigger is open. */
async function openPresets(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByTestId('sched-preset'));
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}

describe('SchedulePicker — modes', () => {
  it('starts in preset mode when the pattern is one of the curated presets', () => {
    render(<SchedulePicker trigger={schedule()} onChange={vi.fn()} testId="sched" />);
    expect(screen.getByTestId('sched-mode-preset')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('sched-preset')).toBeInTheDocument();
  });

  it('starts in custom mode when the pattern is a recurring time no preset offers', () => {
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'daily', at: '07:15' } })}
        onChange={vi.fn()}
        testId="sched"
      />,
    );
    expect(screen.getByTestId('sched-mode-custom')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('sched-at')).toHaveValue('07:15');
  });

  it('starts in one-off mode when the pattern is a single datetime', () => {
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'once', at: '2026-08-01T14:00' } })}
        onChange={vi.fn()}
        testId="sched"
      />,
    );
    expect(screen.getByTestId('sched-mode-once')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('sched-once-at')).toHaveValue('2026-08-01T14:00');
  });

  it('summarizes a one-off in words, so the raw datetime is never the only reading', () => {
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'once', at: '2026-08-01T14:00' } })}
        onChange={vi.fn()}
        testId="sched"
      />,
    );
    expect(screen.getByTestId('sched-summary')).toHaveTextContent('Once on 2026-08-01 at 14:00');
  });
});

describe('SchedulePicker — curated presets', () => {
  it('every preset offered for every-N-hours is a divisor of 24', async () => {
    const user = userEvent.setup();
    render(<SchedulePicker trigger={schedule()} onChange={vi.fn()} testId="sched" />);
    const hourOptions = (await openPresets(user)).filter((label) => /hour/.test(label));
    expect(hourOptions.length).toBeGreaterThan(0);
    for (const label of hourOptions) {
      const n = Number(label.match(/(\d+) hour/)?.[1]);
      expect(24 % n).toBe(0);
    }
  });

  it('picking a preset calls onChange with that SchedulePattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule()} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-preset'));
    await user.click(screen.getByTestId('sched-preset-option-every-4-hours'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'every_n_hours', n: 4 } });
  });

  it('picking a non-hourly preset calls onChange with that SchedulePattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule()} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-preset'));
    await user.click(screen.getByTestId('sched-preset-option-weekdays-06-00'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'weekdays', at: '06:00' } });
  });
});

describe('SchedulePicker — custom mode', () => {
  it('switching to custom keeps a recurring pattern untouched', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule()} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-mode-custom'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('sched-at')).toHaveValue('09:00');
  });

  it('switching to custom from a one-off keeps the time of day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'once', at: '2026-08-01T14:00' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    await user.click(screen.getByTestId('sched-mode-custom'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'daily', at: '14:00' } });
  });

  it('switching to custom from every-N-hours falls back to a daily time, never an unrenderable pattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'every_n_hours', n: 6 } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    await user.click(screen.getByTestId('sched-mode-custom'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'daily', at: '09:00' } });
  });

  it('choosing weekly emits a weekly pattern seeded with a day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'daily', at: '07:15' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    await user.click(screen.getByTestId('sched-frequency'));
    await user.click(screen.getByTestId('sched-frequency-option-weekly'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'weekly', days: [1], at: '07:15' } });
  });

  it('toggling a weekday adds it to the weekly pattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'weekly', days: [1], at: '07:15' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    await user.click(screen.getByTestId('sched-day-3'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'weekly', days: [1, 3], at: '07:15' } });
  });

  it('never leaves a weekly pattern without a day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'weekly', days: [1], at: '07:15' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    await user.click(screen.getByTestId('sched-day-1'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('editing the time emits the same frequency at the new time', () => {
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'weekdays', at: '07:15' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    fireEvent.change(screen.getByTestId('sched-at'), { target: { value: '08:30' } });
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'weekdays', at: '08:30' } });
  });

  it('clearing the time emits nothing and keeps the last valid value', () => {
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'weekdays', at: '07:15' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    fireEvent.change(screen.getByTestId('sched-at'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('sched-at')).toHaveValue('07:15');
  });
});

describe('SchedulePicker — one-off mode', () => {
  it('waits for a datetime before emitting, so the saved pattern is never half-written', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule()} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-mode-once'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('sched-once-at')).toHaveValue('');
  });

  it('picking a datetime emits a once pattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule()} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-mode-once'));
    fireEvent.change(screen.getByTestId('sched-once-at'), { target: { value: '2026-08-01T14:00' } });
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'once', at: '2026-08-01T14:00' } });
  });

  it('switching back to preset replaces a one-off with a recurring preset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchedulePicker
        trigger={schedule({ schedule: { type: 'once', at: '2026-08-01T14:00' } })}
        onChange={onChange}
        testId="sched"
      />,
    );
    await user.click(screen.getByTestId('sched-mode-preset'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'daily', at: '09:00' } });
  });
});

describe('SchedulePicker — onMissed toggle', () => {
  it('reflects run_once as checked', () => {
    render(<SchedulePicker trigger={schedule({ onMissed: 'run_once' })} onChange={vi.fn()} testId="sched" />);
    expect(screen.getByTestId('sched-onmissed')).toHaveAttribute('data-state', 'checked');
  });

  it('reflects skip as unchecked', () => {
    render(<SchedulePicker trigger={schedule({ onMissed: 'skip' })} onChange={vi.fn()} testId="sched" />);
    expect(screen.getByTestId('sched-onmissed')).toHaveAttribute('data-state', 'unchecked');
  });

  it('toggling on calls onChange with onMissed: run_once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule({ onMissed: 'skip' })} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-onmissed'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule({ onMissed: 'skip' }), onMissed: 'run_once' });
  });

  it('toggling off calls onChange with onMissed: skip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule({ onMissed: 'run_once' })} onChange={onChange} testId="sched" />);
    await user.click(screen.getByTestId('sched-onmissed'));
    expect(onChange).toHaveBeenCalledWith({ ...schedule({ onMissed: 'run_once' }), onMissed: 'skip' });
  });
});
