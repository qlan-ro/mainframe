/**
 * SessionSortMenu — Sort By popover behavior.
 *
 * Behaviors covered:
 *  1. Renders the trigger button (data-testid="sessions-sort-button").
 *  2. Clicking the trigger opens the popover listing all three sort options.
 *  3. Clicking an option calls onChange with that option id and closes the popover.
 *  4. The active option carries aria-checked="true".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSortMenu } from '../SessionSortMenu';

it('renders data-testid="sessions-sort-button"', () => {
  render(<SessionSortMenu mode="recent" onChange={vi.fn()} />);
  expect(screen.getByTestId('sessions-sort-button')).toBeTruthy();
});

it('shows recent / name / status options after opening', async () => {
  render(<SessionSortMenu mode="recent" onChange={vi.fn()} />);
  await userEvent.click(screen.getByTestId('sessions-sort-button'));
  expect(screen.getByTestId('sessions-sort-recent')).toBeTruthy();
  expect(screen.getByTestId('sessions-sort-name')).toBeTruthy();
  expect(screen.getByTestId('sessions-sort-status')).toBeTruthy();
});

describe('SessionSortMenu — selecting an option', () => {
  it('calls onChange with the chosen id', async () => {
    const onChange = vi.fn();
    render(<SessionSortMenu mode="recent" onChange={onChange} />);
    await userEvent.click(screen.getByTestId('sessions-sort-button'));
    await userEvent.click(screen.getByTestId('sessions-sort-name'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('name');
  });

  it('closes the popover after a selection', async () => {
    const onChange = vi.fn();
    render(<SessionSortMenu mode="recent" onChange={onChange} />);
    await userEvent.click(screen.getByTestId('sessions-sort-button'));
    await userEvent.click(screen.getByTestId('sessions-sort-status'));
    await waitFor(() => {
      expect(screen.queryByTestId('sessions-sort-status')).toBeNull();
    });
  });
});

it('marks the active option with aria-pressed="true"', async () => {
  render(<SessionSortMenu mode="status" onChange={vi.fn()} />);
  await userEvent.click(screen.getByTestId('sessions-sort-button'));
  expect(screen.getByTestId('sessions-sort-status').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByTestId('sessions-sort-recent').getAttribute('aria-pressed')).toBe('false');
});
