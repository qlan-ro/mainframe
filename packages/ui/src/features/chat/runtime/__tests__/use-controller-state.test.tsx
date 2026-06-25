/**
 * Regression tests for useControllerState — subscribe stability fix.
 *
 * Bug (now fixed): an inline arrow `(l) => controller.subscribeState(l)` was
 * passed directly to useSyncExternalStore. React received a new function
 * reference on every render, triggering a fresh subscribe/unsubscribe cycle
 * each time. After the dormancy split useControllerState reads
 * `controller.subscribeState` (state-change only — never opens a WS sub), so
 * the storm risk is gone; this test still pins the stable-identity contract.
 *
 * Fix: subscribe and getSnapshot are wrapped in useCallback(..., [controller]),
 * making them stable across renders. They only change when the controller
 * identity itself changes.
 *
 * These tests assert the observable subscribe/unsubscribe call counts; they
 * do NOT inspect React's internal useCallback — the call counts are the proof.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useControllerState } from '../use-chat-thread-runtime';
import type { ChatThreadController } from '../../controller/chat-thread-controller';

// ---------------------------------------------------------------------------
// Minimal fake controller — only subscribeState and getState are used by the hook.
// ---------------------------------------------------------------------------

function fakeController() {
  const state = { foo: 'bar' } as const;
  const unsubscribe = vi.fn();
  const subscribeState = vi.fn((_listener: () => void) => unsubscribe);
  const getState = vi.fn(() => state);
  return {
    subscribeState,
    getState,
    unsubscribe,
    state,
  } as unknown as {
    subscribeState: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    state: { foo: string };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useControllerState', () => {
  it('calls controller.subscribeState exactly once across multiple re-renders of the same controller (regression)', () => {
    const fake = fakeController();

    const { rerender } = renderHook(
      ({ c }: { c: typeof fake }) => useControllerState(c as unknown as ChatThreadController),
      { initialProps: { c: fake } },
    );

    rerender({ c: fake });
    rerender({ c: fake });
    rerender({ c: fake });
    rerender({ c: fake });
    rerender({ c: fake });

    // subscribe must have been called ONCE — stable callback identity across renders.
    expect(fake.subscribeState).toHaveBeenCalledTimes(1);
    // Still mounted with the same controller — unsubscribe must NOT have been called.
    expect(fake.unsubscribe).toHaveBeenCalledTimes(0);
  });

  it('returns the stable state object from controller.getState', () => {
    const fake = fakeController();

    const { result } = renderHook(() => useControllerState(fake as unknown as ChatThreadController));

    // The return value must be the exact object getState() vends — { foo: 'bar' }.
    expect(result.current).toEqual({ foo: 'bar' });
    expect(result.current).toBe(fake.state);
  });

  it('re-subscribes when the controller identity changes', () => {
    const fake1 = fakeController();
    const fake2 = fakeController();

    const { rerender } = renderHook(
      ({ c }: { c: typeof fake1 }) => useControllerState(c as unknown as ChatThreadController),
      { initialProps: { c: fake1 } },
    );

    // Switch to a different controller instance.
    act(() => {
      rerender({ c: fake2 });
    });

    // Old controller must have been unsubscribed exactly once.
    expect(fake1.unsubscribe).toHaveBeenCalledTimes(1);
    // New controller must have been subscribed exactly once.
    expect(fake2.subscribeState).toHaveBeenCalledTimes(1);
    // Old controller was only ever subscribed once total (initial mount).
    expect(fake1.subscribeState).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from the controller on unmount', () => {
    const fake = fakeController();

    const { unmount } = renderHook(() => useControllerState(fake as unknown as ChatThreadController));

    unmount();

    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
