// @vitest-environment jsdom
/**
 * useRowHoverCard — behavior tests (TDD red phase).
 *
 * Captures the hovered row's DOMRect after the shared tooltip delay
 * (TOOLTIP_DELAY_MS — 0 under test), and clears it on mouse-leave (cancelling
 * any pending show if the pointer leaves before the delay elapses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRowHoverCard } from '../use-row-hover-card';

function fakeEnterEvent(rect: Partial<DOMRect>) {
  return {
    currentTarget: { getBoundingClientRect: () => rect as DOMRect },
  } as unknown as React.MouseEvent<HTMLElement>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRowHoverCard', () => {
  it('starts with rect=null', () => {
    const { result } = renderHook(() => useRowHoverCard());
    expect(result.current.rect).toBeNull();
  });

  it('sets rect from the entered element after the delay elapses', () => {
    const { result } = renderHook(() => useRowHoverCard());
    act(() => result.current.onMouseEnter(fakeEnterEvent({ top: 10, left: 20 })));
    act(() => vi.runAllTimers());
    expect(result.current.rect).toEqual({ top: 10, left: 20 });
  });

  it('clears rect on mouse-leave', () => {
    const { result } = renderHook(() => useRowHoverCard());
    act(() => result.current.onMouseEnter(fakeEnterEvent({ top: 10, left: 20 })));
    act(() => vi.runAllTimers());
    act(() => result.current.onMouseLeave());
    expect(result.current.rect).toBeNull();
  });

  it('cancels a pending show when mouse-leave fires before the delay elapses', () => {
    const { result } = renderHook(() => useRowHoverCard());
    act(() => result.current.onMouseEnter(fakeEnterEvent({ top: 10, left: 20 })));
    act(() => result.current.onMouseLeave());
    act(() => vi.runAllTimers());
    expect(result.current.rect).toBeNull();
  });
});
