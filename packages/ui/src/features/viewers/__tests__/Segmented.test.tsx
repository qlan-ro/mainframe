/**
 * Segmented tests.
 *
 * Behaviors covered:
 *  1. Renders one button per option, with the option's label.
 *  2. The active option (id === value) gets the raised bg-background segment.
 *  3. Inactive options get the idle text classes, not the active classes.
 *  4. Clicking an option calls onChange with that option's id.
 *  5. aria-pressed reflects active state per option.
 *  6. testId prop is forwarded to the button's data-testid when provided.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented } from '../Segmented';

const OPTIONS = [
  { id: 'fit', label: 'Fit', testId: 'seg-fit' },
  { id: 'actual', label: '100%', testId: 'seg-actual' },
];

describe('Segmented', () => {
  it('renders one button per option with its label', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByText('Fit')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('marks the active option with the raised bg-background segment', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    const active = screen.getByTestId('seg-fit');
    expect(active.className).toContain('bg-background');
  });

  it('marks inactive options with idle text classes, not bg-background', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    const idle = screen.getByTestId('seg-actual');
    expect(idle.className).not.toContain('bg-background');
    expect(idle.className).toContain('text-mf-text-3');
  });

  it('calls onChange with the clicked option id', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Segmented value="fit" onChange={onChange} options={OPTIONS} />);
    await user.click(screen.getByTestId('seg-actual'));
    expect(onChange).toHaveBeenCalledWith('actual');
  });

  it('sets aria-pressed=true on the active option and false on inactive ones', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByTestId('seg-fit')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('seg-actual')).toHaveAttribute('aria-pressed', 'false');
  });
});
