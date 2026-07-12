/**
 * MiniSelect — compact curated-options select (ts153 `WfMiniSelect`). TDD:
 * test written first, component implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiniSelect } from '../MiniSelect';

const OPTIONS = ['Every day at 21:00', 'Every day at 8:00', 'Weekdays at 6:00'];
const FIRST_OPTION = OPTIONS[0]!;

describe('MiniSelect', () => {
  it('renders the current value and every option', () => {
    render(<MiniSelect value={FIRST_OPTION} onChange={vi.fn()} options={OPTIONS} testId="schedule-select" />);
    const select = screen.getByTestId('schedule-select') as HTMLSelectElement;
    expect(select.value).toBe('Every day at 21:00');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('calls onChange with the selected option', () => {
    const onChange = vi.fn();
    render(<MiniSelect value={FIRST_OPTION} onChange={onChange} options={OPTIONS} testId="schedule-select" />);
    fireEvent.change(screen.getByTestId('schedule-select'), { target: { value: 'Weekdays at 6:00' } });
    expect(onChange).toHaveBeenCalledWith('Weekdays at 6:00');
  });

  it('is a controlled component — value only changes via a re-render, not internal state', () => {
    render(<MiniSelect value={FIRST_OPTION} onChange={vi.fn()} options={OPTIONS} testId="schedule-select" />);
    const select = screen.getByTestId('schedule-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Weekdays at 6:00' } });
    expect(select.value).toBe('Every day at 21:00');
  });
});
