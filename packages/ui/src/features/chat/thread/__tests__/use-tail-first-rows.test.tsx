// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { useFindInChatStore } from '../../find/find-in-chat-store';
import { FIRST_ROWS, STEP_ROWS, useTailFirstRows } from '../use-tail-first-rows';
import type { TranscriptScrollController } from '../transcript-scroll-context';

const make = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({ id: `m${from + i}` }));
const owner = (beforePrepend: () => void): TranscriptScrollController => ({
  owned: true,
  viewportElement: { current: null },
  isFollowing: () => false,
  beginInteraction: () => () => undefined,
  beforePrepend,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  useFindInChatStore.setState({ isOpen: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = () => act(() => void vi.advanceTimersByTime(5));

describe('tail-first mount', () => {
  it('mounts the newest rows first, then lands the rest above in slices', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, null));
    expect(result.current.map((r) => r.id)).toEqual(rows.slice(-FIRST_ROWS).map((r) => r.id));
    tick();
    expect(result.current).toHaveLength(FIRST_ROWS + STEP_ROWS);
    tick();
    tick();
    expect(result.current).toHaveLength(40);
    expect(result.current[0]!.id).toBe('m0');
  });

  it('keeps the newest rows at the end while the slices land', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, null));
    for (let i = 0; i < 4; i++) {
      expect(result.current[result.current.length - 1]!.id).toBe('m39');
      tick();
    }
  });

  it('tells the owner before each slice, so a reader near the top is re-anchored', () => {
    const beforePrepend = vi.fn();
    const rows = make(40);
    renderHook(() => useTailFirstRows(rows, owner(beforePrepend)));
    expect(beforePrepend).not.toHaveBeenCalled();
    tick();
    expect(beforePrepend).toHaveBeenCalledTimes(1);
    tick();
    tick();
    expect(beforePrepend).toHaveBeenCalledTimes(3);
  });

  it('shows a short window whole at once', () => {
    const rows = make(FIRST_ROWS);
    const { result } = renderHook(() => useTailFirstRows(rows, null));
    expect(result.current).toHaveLength(FIRST_ROWS);
  });

  it('waits for the first messages, then mounts the tail first', () => {
    let rows = make(0);
    const { result, rerender } = renderHook(() => useTailFirstRows(rows, null));
    expect(result.current).toHaveLength(0);
    rows = make(40);
    rerender();
    expect(result.current).toHaveLength(FIRST_ROWS);
  });

  it('adds rows streamed at the end without losing the rows above', () => {
    let rows = make(40);
    const { result, rerender } = renderHook(() => useTailFirstRows(rows, null));
    tick();
    rows = make(41);
    rerender();
    expect(result.current[result.current.length - 1]!.id).toBe('m40');
    tick();
    tick();
    expect(result.current).toHaveLength(41);
  });

  it('puts an older page that lands meanwhile in the rows still to come', () => {
    let rows = make(40, 100);
    const { result, rerender } = renderHook(() => useTailFirstRows(rows, null));
    rows = [...make(30, 70), ...rows];
    rerender();
    const shown = result.current.length;
    expect(shown).toBe(FIRST_ROWS);
    for (let i = 0; i < 8; i++) tick();
    expect(result.current).toHaveLength(70);
    expect(result.current[0]!.id).toBe('m70');
  });

  it('shows every row at once for a jump to a row', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, null));
    act(() => void window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId: 'c' } })));
    expect(result.current).toHaveLength(40);
  });

  it('shows every row at once while Find is open', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, null));
    act(() => useFindInChatStore.setState({ isOpen: true }));
    expect(result.current).toHaveLength(40);
  });
});
