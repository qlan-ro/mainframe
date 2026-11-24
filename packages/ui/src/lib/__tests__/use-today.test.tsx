// @vitest-environment jsdom
/**
 * useToday — the local day as state: it moves at midnight, and re-renders its
 * consumer at no other time.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToday } from '../use-today';

let renders = 0;

function Probe() {
  renders += 1;
  return <span data-testid="day">{new Date(useToday()).getDate()}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 23, 23, 58));
  renders = 0;
});
afterEach(() => vi.useRealTimers());

it('moves to the next day at midnight and stays quiet until then', () => {
  render(<Probe />);
  expect(screen.getByTestId('day')).toHaveTextContent('23');

  act(() => void vi.advanceTimersByTime(90_000));
  expect(screen.getByTestId('day')).toHaveTextContent('23');
  expect(renders).toBe(1);

  act(() => void vi.advanceTimersByTime(60_000));
  expect(screen.getByTestId('day')).toHaveTextContent('24');
});
