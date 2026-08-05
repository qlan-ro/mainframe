/**
 * Segmented tests.
 *
 * Segmented is the v2 Tabs List+Trigger recipe, so the contract is Radix's:
 * `role="tab"` triggers, `aria-selected` for the active one, and activation on
 * mouse-down rather than click.
 *
 * Behaviors covered:
 *  1. Renders one tab per option, with the option's label.
 *  2. aria-selected marks exactly the active option.
 *  3. Selecting an option calls onChange with that option's id.
 *  4. Re-selecting the active option does not re-fire onChange.
 *  5. testId prop is forwarded to each trigger's data-testid.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Segmented } from '../Segmented';

const OPTIONS = [
  { id: 'fit', label: 'Fit', testId: 'seg-fit' },
  { id: 'actual', label: '100%', testId: 'seg-actual' },
];

describe('Segmented', () => {
  it('renders one tab per option with its label', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('Fit')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('marks the active option aria-selected and the others not', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByTestId('seg-fit')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('seg-actual')).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the selected option id', () => {
    const onChange = vi.fn();
    render(<Segmented value="fit" onChange={onChange} options={OPTIONS} />);
    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('seg-actual'));
    expect(onChange).toHaveBeenCalledWith('actual');
  });

  it('does not re-fire onChange for the already-active option', () => {
    const onChange = vi.fn();
    render(<Segmented value="fit" onChange={onChange} options={OPTIONS} />);
    fireEvent.mouseDown(screen.getByTestId('seg-fit'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards testId to each trigger', () => {
    render(<Segmented value="fit" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByTestId('seg-fit')).toBeInTheDocument();
    expect(screen.getByTestId('seg-actual')).toBeInTheDocument();
  });
});
