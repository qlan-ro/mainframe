// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTrimAtTail } from '../use-trim-at-tail';

function pin(initial: boolean) {
  let pinned = initial;
  const listeners = new Set<() => void>();
  return {
    isPinned: () => pinned,
    subscribePinned: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value: boolean) {
      pinned = value;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

describe('trimming when the reader returns to the tail', () => {
  it('trims once when the reader comes back to the bottom', () => {
    const owner = pin(true);
    const trim = vi.fn();
    renderHook(() => useTrimAtTail(owner, trim, false));
    expect(trim).not.toHaveBeenCalled();
    owner.set(false);
    expect(trim).not.toHaveBeenCalled();
    owner.set(true);
    expect(trim).toHaveBeenCalledTimes(1);
  });

  it('does not trim while the reader stays at the bottom', () => {
    const owner = pin(true);
    const trim = vi.fn();
    const { rerender } = renderHook(() => useTrimAtTail(owner, trim, false));
    rerender();
    expect(trim).not.toHaveBeenCalled();
  });

  it('does not trim in a window around a jump target', () => {
    const owner = pin(false);
    const trim = vi.fn();
    renderHook(() => useTrimAtTail(owner, trim, true));
    owner.set(true);
    expect(trim).not.toHaveBeenCalled();
  });

  it('trims again on the next return', () => {
    const owner = pin(false);
    const trim = vi.fn();
    renderHook(() => useTrimAtTail(owner, trim, false));
    owner.set(true);
    owner.set(false);
    owner.set(true);
    expect(trim).toHaveBeenCalledTimes(2);
  });
});
