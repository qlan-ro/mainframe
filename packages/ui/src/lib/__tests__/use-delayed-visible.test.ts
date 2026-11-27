// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedVisible } from '../use-delayed-visible';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const options = { delay: 200, minVisible: 300 };

describe('useDelayedVisible', () => {
  it('shows nothing for an activity shorter than the delay', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedVisible(active, options), {
      initialProps: { active: true },
    });
    advance(199);
    expect(result.current).toBe(false);
    rerender({ active: false });
    advance(1000);
    expect(result.current).toBe(false);
  });

  it('shows after the delay and holds for the minimum once the activity ends', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedVisible(active, options), {
      initialProps: { active: true },
    });
    advance(200);
    expect(result.current).toBe(true);
    advance(50);
    rerender({ active: false });
    advance(249);
    expect(result.current).toBe(true);
    advance(1);
    expect(result.current).toBe(false);
  });

  it('hides at once when the activity ends after the minimum has passed', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedVisible(active, options), {
      initialProps: { active: true },
    });
    advance(900);
    expect(result.current).toBe(true);
    rerender({ active: false });
    advance(0);
    expect(result.current).toBe(false);
  });

  it('with no delay shows on the first render, and still holds for the minimum', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedVisible(active, { delay: 0, minVisible: 300 }), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(true);
    advance(100);
    rerender({ active: false });
    expect(result.current).toBe(true);
    advance(200);
    expect(result.current).toBe(false);
  });

  it('starts over when the key changes', () => {
    const { result, rerender } = renderHook(({ key }) => useDelayedVisible(true, { ...options, resetKey: key }), {
      initialProps: { key: 'a' },
    });
    advance(200);
    expect(result.current).toBe(true);
    rerender({ key: 'b' });
    expect(result.current).toBe(false);
    advance(200);
    expect(result.current).toBe(true);
  });
});
