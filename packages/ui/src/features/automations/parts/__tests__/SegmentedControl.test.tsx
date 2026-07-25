/**
 * SegmentedControl — the one-of-N mode switch the schedule surface uses
 * (todo #234 T18). No shared tabs/segmented primitive exists in
 * `components/ui/`, so this is a local part; the suite pins its contract
 * (one button per option, a single pressed option, a value-typed callback)
 * rather than its looks. TDD: test written first, implemented after.
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

  it('marks exactly one option as pressed', () => {
    render(<SegmentedControl options={OPTIONS} value="custom" onChange={vi.fn()} testIdPrefix="sched-mode" />);
    expect(screen.getByTestId('sched-mode-custom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sched-mode-preset')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('sched-mode-once')).toHaveAttribute('aria-pressed', 'false');
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

  it('groups the buttons under one labelled group for screen readers', () => {
    render(
      <SegmentedControl
        options={OPTIONS}
        value="preset"
        onChange={vi.fn()}
        testIdPrefix="sched-mode"
        label="Schedule mode"
      />,
    );
    expect(screen.getByRole('group', { name: 'Schedule mode' })).toContainElement(
      screen.getByTestId('sched-mode-once'),
    );
  });
});
