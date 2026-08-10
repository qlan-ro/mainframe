// @vitest-environment jsdom
/**
 * use-run-elapsed — unit tests for the running indicator's live elapsed timer.
 *
 * Every expectation is a hardcoded string/number, not a re-derivation of the
 * formatter's own arithmetic.
 *
 * Behaviors covered:
 *  - nothing is reported below 1s (a sub-second run must not flash "0s")
 *  - the count ticks once per second while a run is active
 *  - it clears when the run ends, and a second run restarts from zero
 *
 * The readout's formatting lives in `features/chat/__tests__/format-duration`.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRunElapsed } from '../use-run-elapsed';

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
