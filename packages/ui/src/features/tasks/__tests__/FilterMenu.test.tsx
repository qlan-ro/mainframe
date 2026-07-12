/**
 * FilterMenu.test.tsx
 *
 * Behaviors covered:
 *  1.  Renders data-testid="tasks-filter-<kebab-label>" trigger button.
 *  2.  When a selection exists, the count renders as a distinct pill
 *      (data-testid="tasks-filter-<label>-count"), not inline parenthetical
 *      text (finding 9.12 — design: 12-todos.jsx:196-208).
 *  3.  No count pill renders when nothing is selected.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterMenu, type FilterOption } from '../FilterMenu';

const OPTIONS: FilterOption[] = [
  { value: 'bug', label: 'bug', count: 3 },
  { value: 'feature', label: 'feature', count: 1 },
];

describe('FilterMenu — trigger testid', () => {
  it('renders tasks-filter-type', () => {
    render(<FilterMenu label="Type" options={OPTIONS} selected={[]} onChange={() => {}} />);
    expect(screen.getByTestId('tasks-filter-type')).toBeTruthy();
  });
});

describe('FilterMenu — selected-count pill (finding 9.12)', () => {
  it('renders a count pill (tasks-filter-type-count) when a selection is active', () => {
    render(<FilterMenu label="Type" options={OPTIONS} selected={['bug']} onChange={() => {}} />);
    const pill = screen.getByTestId('tasks-filter-type-count');
    expect(pill.textContent).toBe('1');
    expect(pill.className).toContain('tabular-nums');
  });

  it('does NOT render a parenthetical "(1)" text node', () => {
    render(<FilterMenu label="Type" options={OPTIONS} selected={['bug']} onChange={() => {}} />);
    expect(screen.queryByText('(1)')).toBeNull();
  });

  it('does NOT render the count pill when nothing is selected', () => {
    render(<FilterMenu label="Type" options={OPTIONS} selected={[]} onChange={() => {}} />);
    expect(screen.queryByTestId('tasks-filter-type-count')).toBeNull();
  });
});
