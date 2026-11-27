// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { useFindInChatStore } from '../../find/find-in-chat-store';
import { FIRST_ROWS, STEP_ROWS, useTailFirstRows } from '../use-tail-first-rows';
import type { TranscriptScrollController } from '../transcript-scroll-context';

const make = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({ id: `m${from + i}` }));
const owner = (
  beforePrepend: () => void,
  extra: Partial<TranscriptScrollController> = {},
): TranscriptScrollController => ({
  owned: true,
  chatId: 'chat',
  findOwner: true,
  viewportElement: { current: null },
  isFollowing: () => false,
  beginInteraction: () => () => undefined,
  beforePrepend,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  useFindInChatStore.setState({ isOpen: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = () => act(() => void vi.advanceTimersByTime(17));

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

  it('shows every row at once for a jump to a row of this chat, and ignores one for another chat', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, owner(vi.fn())));
    act(() => void window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId: 'other' } })));
    expect(result.current).toHaveLength(FIRST_ROWS);
    act(() => void window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId: 'chat' } })));
    expect(result.current).toHaveLength(40);
  });

  it('shows every row at once while Find is open in the chat that owns it', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, owner(vi.fn())));
    act(() => useFindInChatStore.setState({ isOpen: true }));
    expect(result.current).toHaveLength(40);
  });

  it('keeps every row mounted when Find closes again (Escape), so the reader’s block does not unmount', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, owner(vi.fn())));
    act(() => useFindInChatStore.setState({ isOpen: true }));
    const above = result.current.map((row) => row.id);
    act(() => useFindInChatStore.setState({ isOpen: false }));
    tick();
    tick();
    expect(result.current.map((row) => row.id)).toEqual(above);
    expect(result.current).toHaveLength(40);
  });

  it('does not reveal rows for Find in a list that does not own it', () => {
    const rows = make(40);
    const { result } = renderHook(() => useTailFirstRows(rows, owner(vi.fn(), { findOwner: false })));
    act(() => useFindInChatStore.setState({ isOpen: true }));
    expect(result.current).toHaveLength(FIRST_ROWS);
  });

  it('reports whether rows are still to land above, so the top does not claim the start too early', () => {
    const pending = vi.fn();
    const rows = make(40);
    const { result } = renderHook(() =>
      useTailFirstRows(
        rows,
        owner(vi.fn(), { tailPending: { get: () => false, subscribe: () => () => {}, set: pending } }),
      ),
    );
    expect(pending).toHaveBeenLastCalledWith(true);
    for (let i = 0; i < 4; i++) tick();
    expect(result.current).toHaveLength(40);
    expect(pending).toHaveBeenLastCalledWith(false);
  });
});
