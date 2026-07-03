/**
 * ReasoningGroup — behavior tests for the client-side "Thought for Ns"
 * duration measurement.
 *
 * The daemon delivers thinking as complete blocks with no timing, so the
 * duration is measured LIVE: the wall-clock window during which the group
 * reports `running`. These tests use fake timers so the window is
 * deterministic (vitest's fake-timer clock also drives `Date.now()`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, render, screen, act } from '@testing-library/react';
import { useReasoningDuration, ReasoningGroup } from '../ReasoningGroup';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Hook — useReasoningDuration
// ---------------------------------------------------------------------------

describe('useReasoningDuration — measures a running→done window', () => {
  it('returns 3 after a 3000ms running window ends', () => {
    const { result, rerender } = renderHook(({ running }: { running: boolean }) => useReasoningDuration(running), {
      initialProps: { running: true },
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    rerender({ running: false });

    expect(result.current).toBe(3);
  });
});

describe('useReasoningDuration — sub-second window', () => {
  it('returns undefined when the running window is under 1 second', () => {
    const { result, rerender } = renderHook(({ running }: { running: boolean }) => useReasoningDuration(running), {
      initialProps: { running: true },
    });

    act(() => {
      vi.advanceTimersByTime(400);
    });

    rerender({ running: false });

    expect(result.current).toBeUndefined();
  });
});

describe('useReasoningDuration — never observed running (history)', () => {
  it('returns undefined when mounted with running=false and never flipped', () => {
    const { result } = renderHook(() => useReasoningDuration(false));

    expect(result.current).toBeUndefined();
  });
});

describe('useReasoningDuration — still running', () => {
  it('returns undefined while running, even after time has advanced', () => {
    const { result } = renderHook(() => useReasoningDuration(true));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBeUndefined();
  });
});

describe('useReasoningDuration — re-enters running', () => {
  it('clears back to undefined when running flips true again after a measured window', () => {
    const { result, rerender } = renderHook(({ running }: { running: boolean }) => useReasoningDuration(running), {
      initialProps: { running: true },
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender({ running: false });
    expect(result.current).toBe(2);

    rerender({ running: true });
    expect(result.current).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Component — ReasoningGroup
// ---------------------------------------------------------------------------

describe('ReasoningGroup — live running state', () => {
  it('shows "Thinking…" on the toggle while running', () => {
    render(<ReasoningGroup running={true}>reasoning body</ReasoningGroup>);

    expect(screen.getByTestId('chat-reasoning-toggle')).toHaveTextContent('Thinking…');
  });
});

describe('ReasoningGroup — running→done transition', () => {
  it('shows "Thought for 5s" on the toggle after a 5000ms running window ends', () => {
    const { rerender } = render(<ReasoningGroup running={true}>reasoning body</ReasoningGroup>);

    expect(screen.getByTestId('chat-reasoning-toggle')).toHaveTextContent('Thinking…');

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    rerender(<ReasoningGroup running={false}>reasoning body</ReasoningGroup>);

    expect(screen.getByTestId('chat-reasoning-toggle')).toHaveTextContent('Thought for 5s');
  });
});

describe('ReasoningGroup — history (never observed running)', () => {
  it('shows "Reasoning" on the toggle when mounted with running=false', () => {
    render(<ReasoningGroup running={false}>reasoning body</ReasoningGroup>);

    expect(screen.getByTestId('chat-reasoning-toggle')).toHaveTextContent('Reasoning');
  });
});
