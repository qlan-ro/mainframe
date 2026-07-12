/**
 * SchedulePicker — curated schedules + onMissed run_once/skip toggle (ts153
 * wf2-fields.jsx `WfSchedulePicker`). Curated every-N-hours presets are
 * restricted to divisors of 24 by construction (4/6/12) — there is no free
 * numeric input to validate. TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduleTrigger } from '../../contract';
import { SchedulePicker } from '../SchedulePicker';

function schedule(overrides: Partial<ScheduleTrigger> = {}): ScheduleTrigger {
  return { id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip', ...overrides };
}

describe('SchedulePicker — curated presets', () => {
  it('every preset offered for every-N-hours is a divisor of 24', () => {
    render(<SchedulePicker trigger={schedule()} onChange={vi.fn()} testId="sched" />);
    const options = Array.from(screen.getByTestId('sched-preset').querySelectorAll('option')).map(
      (o) => o.textContent ?? '',
    );
    const hourOptions = options.filter((label) => /hour/.test(label));
    expect(hourOptions.length).toBeGreaterThan(0);
    for (const label of hourOptions) {
      const n = Number(label.match(/(\d+) hour/)?.[1]);
      expect(24 % n).toBe(0);
    }
  });

  it('picking a preset calls onChange with that SchedulePattern', () => {
    const onChange = vi.fn();
    render(<SchedulePicker trigger={schedule()} onChange={onChange} testId="sched" />);
    fireEvent.change(screen.getByTestId('sched-preset'), { target: { value: 'Every 4 hours' } });
    expect(onChange).toHaveBeenCalledWith({ ...schedule(), schedule: { type: 'every_n_hours', n: 4 } });
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
