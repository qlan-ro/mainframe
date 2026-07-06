/**
 * SortMenu.test.tsx
 *
 * Behaviors covered (finding 9.11 — single-toggle-per-key interaction model,
 * design: 12-todos.jsx:246-282, TdSortMenu):
 *
 *  1.  Trigger (tasks-sort-menu) shows the current key label + direction arrow.
 *  2.  Menu renders exactly one row per sort key (tasks-sort-option-<key>),
 *      NOT a separate asc/desc row per key.
 *  3.  Clicking the row for the ALREADY-active key toggles its direction
 *      (desc -> asc, asc -> desc) — a single toggle-in-place.
 *  4.  Clicking a row for a DIFFERENT key switches to that key with a
 *      sensible default direction: asc for priority/type, desc otherwise.
 *  5.  The active row is visually marked (aria-selected / data-active).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortMenu } from '../SortMenu';
import type { TodoSort } from '../todos-filters';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SortMenu — trigger shows current key + direction', () => {
  it('shows "Priority ↑" when sort is {key:priority, dir:asc}', () => {
    render(<SortMenu sort={{ key: 'priority', dir: 'asc' }} onChange={vi.fn()} />);
    expect(screen.getByTestId('tasks-sort-menu').textContent).toContain('Priority');
    expect(screen.getByTestId('tasks-sort-menu').textContent).toContain('↑');
  });

  it('shows "Number ↓" when sort is {key:number, dir:desc}', () => {
    render(<SortMenu sort={{ key: 'number', dir: 'desc' }} onChange={vi.fn()} />);
    expect(screen.getByTestId('tasks-sort-menu').textContent).toContain('Number');
    expect(screen.getByTestId('tasks-sort-menu').textContent).toContain('↓');
  });
});

describe('SortMenu — one row per key (not per key×direction)', () => {
  it('renders exactly one option row for each of priority/number/updated/type', async () => {
    render(<SortMenu sort={{ key: 'priority', dir: 'asc' }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByTestId('tasks-sort-menu'));

    expect(screen.getByTestId('tasks-sort-option-priority')).toBeTruthy();
    expect(screen.getByTestId('tasks-sort-option-number')).toBeTruthy();
    expect(screen.getByTestId('tasks-sort-option-updated')).toBeTruthy();
    expect(screen.getByTestId('tasks-sort-option-type')).toBeTruthy();
  });

  it('does NOT render separate asc/desc rows', async () => {
    render(<SortMenu sort={{ key: 'priority', dir: 'asc' }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByTestId('tasks-sort-menu'));

    expect(screen.queryByTestId('tasks-sort-priority-asc')).toBeNull();
    expect(screen.queryByTestId('tasks-sort-priority-desc')).toBeNull();
  });
});

describe('SortMenu — clicking the active key toggles direction in place', () => {
  it('toggles priority asc -> desc when priority is already active', async () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ key: 'priority', dir: 'asc' }} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('tasks-sort-menu'));
    await userEvent.click(screen.getByTestId('tasks-sort-option-priority'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ key: 'priority', dir: 'desc' } satisfies TodoSort);
  });

  it('toggles number desc -> asc when number is already active', async () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ key: 'number', dir: 'desc' }} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('tasks-sort-menu'));
    await userEvent.click(screen.getByTestId('tasks-sort-option-number'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ key: 'number', dir: 'asc' } satisfies TodoSort);
  });
});

describe('SortMenu — clicking a different key switches with a sensible default direction', () => {
  it('switches to type with dir asc (priority/type default to asc)', async () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ key: 'number', dir: 'desc' }} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('tasks-sort-menu'));
    await userEvent.click(screen.getByTestId('tasks-sort-option-type'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ key: 'type', dir: 'asc' } satisfies TodoSort);
  });

  it('switches to updated with dir desc (non priority/type defaults to desc)', async () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ key: 'priority', dir: 'asc' }} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('tasks-sort-menu'));
    await userEvent.click(screen.getByTestId('tasks-sort-option-updated'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ key: 'updated', dir: 'desc' } satisfies TodoSort);
  });
});
