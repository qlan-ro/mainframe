// @vitest-environment jsdom
/**
 * use-rotating-phrase — behavior tests.
 *
 * Behaviors covered:
 *  1. Returns the first phrase immediately on mount (no advance before any tick).
 *  2. Advances to the next phrase on each interval and wraps last→first.
 *  3. Does not advance when active is false from the start.
 *  4. Resets to the first phrase and stops advancing when active flips false.
 *  5. Never advances when the phrase list has only one entry.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useRotatingPhrase } from '../use-rotating-phrase';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Returns the first phrase initially
// ---------------------------------------------------------------------------

describe('useRotatingPhrase — initial value', () => {
  it('returns phrases[0] immediately on mount before any tick', () => {
    const { result } = renderHook(() => useRotatingPhrase(true, ['A', 'B', 'C'], 1000));

    expect(result.current).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// 2. Advances on each interval and wraps around
// ---------------------------------------------------------------------------

describe('useRotatingPhrase — advances and wraps', () => {
  it('moves to B after 1000ms, C after 2000ms, and back to A after 3000ms', () => {
    const { result } = renderHook(() => useRotatingPhrase(true, ['A', 'B', 'C'], 1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('B');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('C');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// 3. Does not advance when active is false
// ---------------------------------------------------------------------------

describe('useRotatingPhrase — inactive from the start', () => {
  it('stays at phrases[0] after 5000ms when active is false', () => {
    const { result } = renderHook(() => useRotatingPhrase(false, ['A', 'B', 'C'], 1000));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// 4. Resets to first phrase when active flips false
// ---------------------------------------------------------------------------

describe('useRotatingPhrase — resets on active flip to false', () => {
  it('returns A after rerender with active=false even when the hook had advanced to B', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useRotatingPhrase(active, ['A', 'B', 'C'], 1000),
      { initialProps: { active: true } },
    );

    // Advance one tick so the phrase moves to B.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('B');

    // Flip active off — should snap back to A immediately.
    rerender({ active: false });
    expect(result.current).toBe('A');

    // Confirm it also stops advancing after the flip.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// 5. Single-phrase list never advances
// ---------------------------------------------------------------------------

describe('useRotatingPhrase — single-phrase list', () => {
  it('stays at "Only" after 5000ms when phrases has one entry', () => {
    const { result } = renderHook(() => useRotatingPhrase(true, ['Only'], 1000));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBe('Only');
  });
});
