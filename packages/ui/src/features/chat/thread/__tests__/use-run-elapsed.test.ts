// @vitest-environment jsdom
/**
 * use-run-elapsed — unit tests for the running indicator's live elapsed timer.
 *
 * Every expectation is a hardcoded string/number, not a re-derivation of the
 * formatter's own arithmetic.
 *
 * Behaviors covered:
 *  - the formatter's three bands (seconds, minutes, hours) and their boundaries
 *  - nothing is reported below 1s (a sub-second run must not flash "0s")
 *  - the count ticks once per second while a run is active
 *  - it clears when the run ends, and a second run restarts from zero
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { formatElapsedSeconds, useRunElapsed } from '../use-run-elapsed';

describe('formatElapsedSeconds', () => {
  it('reports whole seconds below a minute', () => {
    expect(formatElapsedSeconds(0)).toBe('0s');
    expect(formatElapsedSeconds(1)).toBe('1s');
    expect(formatElapsedSeconds(9)).toBe('9s');
    expect(formatElapsedSeconds(59)).toBe('59s');
  });

  it('switches to minutes at 60s, zero-padding the seconds so a ticking readout keeps its width', () => {
    expect(formatElapsedSeconds(60)).toBe('1m 00s');
    expect(formatElapsedSeconds(65)).toBe('1m 05s');
    expect(formatElapsedSeconds(75)).toBe('1m 15s');
    expect(formatElapsedSeconds(600)).toBe('10m 00s');
    expect(formatElapsedSeconds(3599)).toBe('59m 59s');
  });

  it('drops seconds past an hour', () => {
    expect(formatElapsedSeconds(3600)).toBe('1h 00m');
    expect(formatElapsedSeconds(3725)).toBe('1h 02m');
    expect(formatElapsedSeconds(7380)).toBe('2h 03m');
  });

  it('clamps a negative reading to zero', () => {
    expect(formatElapsedSeconds(-5)).toBe('0s');
  });
});

describe('useRunElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports nothing while inactive', () => {
    const { result } = renderHook(() => useRunElapsed(false));
    expect(result.current).toBeUndefined();
  });

  it('reports nothing for the first second of a run', () => {
    const { result } = renderHook(() => useRunElapsed(true));
    expect(result.current).toBeUndefined();

    act(() => void vi.advanceTimersByTime(900));
    expect(result.current).toBeUndefined();
  });

  it('ticks once per second while the run is active', () => {
    const { result } = renderHook(() => useRunElapsed(true));

    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1);

    act(() => void vi.advanceTimersByTime(4000));
    expect(result.current).toBe(5);
  });

  it('clears when the run ends', () => {
    const { result, rerender } = renderHook(({ active }) => useRunElapsed(active), {
      initialProps: { active: true },
    });
    act(() => void vi.advanceTimersByTime(3000));
    expect(result.current).toBe(3);

    rerender({ active: false });
    expect(result.current).toBeUndefined();
  });

  it('restarts from zero on a second run rather than resuming the first', () => {
    const { result, rerender } = renderHook(({ active }) => useRunElapsed(active), {
      initialProps: { active: true },
    });
    act(() => void vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(30);

    rerender({ active: false });
    act(() => void vi.advanceTimersByTime(60_000));
    rerender({ active: true });
    expect(result.current).toBeUndefined();

    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toBe(2);
  });
});
