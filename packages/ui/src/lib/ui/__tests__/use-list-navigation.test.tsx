import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useListNavigation } from '../use-list-navigation';

function press(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLInputElement>;
}

describe('useListNavigation', () => {
  it('clamps ArrowDown/ArrowUp within [0, count-1]', () => {
    const { result } = renderHook(() => useListNavigation(3, vi.fn()));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.handleKeyDown(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.handleKeyDown(press('ArrowUp')));
    act(() => result.current.handleKeyDown(press('ArrowUp')));
    expect(result.current.activeIndex).toBe(0);
  });

  it('Enter confirms the active index', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useListNavigation(2, onConfirm));
    act(() => result.current.handleKeyDown(press('ArrowDown')));
    act(() => result.current.handleKeyDown(press('Enter')));
    expect(onConfirm).toHaveBeenCalledWith(1);
  });

  it('resets active index to 0 when count changes', () => {
    const { result, rerender } = renderHook(({ n }) => useListNavigation(n, vi.fn()), {
      initialProps: { n: 5 },
    });
    act(() => result.current.handleKeyDown(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
    rerender({ n: 2 });
    expect(result.current.activeIndex).toBe(0);
  });
});
