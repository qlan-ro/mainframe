/**
 * SegmentedControl — the one-of-N mode switch the schedule surface uses
 * (todo #234 T18), now on the v2 Tabs primitives. The suite pins its
 * contract in Radix tab semantics: one trigger per option, a single
 * data-state="active" option, a value-typed callback that fires exactly
 * once per pick, and a labelled tablist.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from '../SegmentedControl';

type Mode = 'preset' | 'custom' | 'once';

const OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: 'preset', label: 'Preset' },
  { value: 'custom', label: 'Custom time' },
  { value: 'once', label: 'One-off' },
];

describe('SegmentedControl', () => {
  it('renders one button per option, keyed by the option value', () => {
    render(<SegmentedControl options={OPTIONS} value="preset" onChange={vi.fn()} testIdPrefix="sched-mode" />);
    expect(screen.getByTestId('sched-mode-preset')).toHaveTextContent('Preset');
    expect(screen.getByTestId('sched-mode-custom')).toHaveTextContent('Custom time');
    expect(screen.getByTestId('sched-mode-once')).toHaveTextContent('One-off');
  });

  it('marks exactly one option as active', () => {
    render(<SegmentedControl options={OPTIONS} value="custom" onChange={vi.fn()} testIdPrefix="sched-mode" />);
    expect(screen.getByTestId('sched-mode-custom')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('sched-mode-preset')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('sched-mode-once')).toHaveAttribute('data-state', 'inactive');
  });

  it('emits the picked option value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="preset" onChange={onChange} testIdPrefix="sched-mode" />);
    await user.click(screen.getByTestId('sched-mode-once'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('once');
  });

  it('stays silent when the already-selected option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="preset" onChange={onChange} testIdPrefix="sched-mode" />);
    await user.click(screen.getByTestId('sched-mode-preset'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('groups the triggers under one labelled tablist for screen readers', () => {
    render(
      <SegmentedControl
        options={OPTIONS}
        value="preset"
        onChange={vi.fn()}
        testIdPrefix="sched-mode"
        label="Schedule mode"
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Schedule mode' })).toContainElement(
      screen.getByTestId('sched-mode-once'),
    );
  });
});
