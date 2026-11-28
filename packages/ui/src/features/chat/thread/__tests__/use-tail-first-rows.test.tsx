// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { useFindInChatStore } from '../../find/find-in-chat-store';
import { FIRST_ROWS, MAX_LAYOUT_PASSES, STEP_ROWS, useTailFirstRows } from '../use-tail-first-rows';
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

describe('a tail shorter than the viewport', () => {
  /** A viewport 500 px high whose content is `rowHeight` per mounted row. */
  const sized = (rowHeight: number, clientHeight = 500) => {
    const state = { mounted: 0 };
    const viewport = document.createElement('div');
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { get: () => clientHeight },
      scrollHeight: { get: () => Math.max(clientHeight, state.mounted * rowHeight) },
      scrollTop: { get: () => scrollTop },
    });
    // The owner's `followNow`: the position goes to the bottom of what is mounted when it is asked.
    const followNow = vi.fn(() => {
      scrollTop = viewport.scrollHeight - clientHeight;
    });
    const controller = owner(vi.fn(), { viewportElement: { current: viewport }, followNow });
    const use = (rows: { id: string }[], orderOf?: (id: string) => number | undefined) => {
      const shown = useTailFirstRows(rows, controller, orderOf);
      state.mounted = shown.length;
      return shown;
    };
    /** The tail is in view: the position is at the bottom of the mounted rows. */
    const atTail = () => scrollTop === viewport.scrollHeight - clientHeight;
    return { use, followNow, atTail };
  };

  it('mounts further slices before the first paint until the content overflows the viewport', () => {
    const rows = make(60);
    const { use } = sized(30);
    // Six rows are 180 px, eighteen are 540 px: the second slice fills the viewport, in the first commit.
    const { result } = renderHook(() => use(rows));
    expect(result.current).toHaveLength(FIRST_ROWS + STEP_ROWS);
  });

  it('keeps the tail in view when the pass that mounts the last rows is the one that overflows', () => {
    // Six rows are 240 px; the next pass mounts all fifteen (600 px, past the 500 px viewport) and ends the mount.
    // The owner's resize observer only exists after the first paint, so that pass must ask it to follow.
    const { use, atTail } = sized(40);
    const { result } = renderHook(() => use(make(15)));
    expect(result.current).toHaveLength(15);
    expect(atTail()).toBe(true);
  });

  it('goes on from the nearest row left when the first mounted one is folded away mid-mount', () => {
    const all = make(60);
    const orderOf = (id: string) => Number(id.slice(1));
    const { use } = sized(200);
    const { result, rerender } = renderHook(({ rows }) => use(rows, orderOf), { initialProps: { rows: all } });
    expect(result.current.map((row) => row.id)).toEqual(['m54', 'm55', 'm56', 'm57', 'm58', 'm59']);
    // A turn folds and its empty messages m40 to m56 leave the list, the first mounted row among them.
    rerender({ rows: all.filter((row) => orderOf(row.id) < 40 || orderOf(row.id) > 56) });
    expect(result.current.map((row) => row.id)).toEqual(['m57', 'm58', 'm59']);
  });

  it('stops at the whole window when it never overflows', () => {
    const rows = make(40);
    const { use } = sized(2);
    const { result } = renderHook(() => use(rows));
    expect(result.current).toHaveLength(40);
  });

  it('keeps to the newest rows, and waits for the next task, when they already overflow', () => {
    const rows = make(40);
    const { use } = sized(200);
    const { result, unmount } = renderHook(() => use(rows));
    expect(result.current).toHaveLength(FIRST_ROWS);
    tick();
    expect(result.current).toHaveLength(FIRST_ROWS + STEP_ROWS);
    unmount();
  });

  it('bounds the passes before paint for a tail of near-empty rows (no update-depth error, no hundreds of rows)', () => {
    const rows = make(1000);
    // 1 px rows in an 800 px viewport never overflow within the layout passes.
    const { use, followNow } = sized(1, 800);
    const { result, unmount } = renderHook(() => use(rows));
    // 6 + 12 + 24 + 48 + 96 * 5 rows at most (570), and the owner is asked to stay at the tail on every pass.
    expect(result.current.length).toBeLessThanOrEqual(FIRST_ROWS + 12 + 24 + 48 + 96 * (MAX_LAYOUT_PASSES - 3));
    expect(result.current.length).toBe(570);
    expect(result.current.length).toBeLessThan(1000);
    expect(followNow).toHaveBeenCalled();
    expect(followNow.mock.calls.length).toBeLessThanOrEqual(MAX_LAYOUT_PASSES + 1);
    expect(result.current[result.current.length - 1]!.id).toBe('m999');
    // The first task-sized slice lands above them, and its commit gets a fresh budget of layout passes.
    tick();
    expect(result.current.length).toBeGreaterThan(570);
    // The window finishes within twenty more frames. With the budget reset each frame adds its slice and further layout
    // passes; without it only the twelve rows of the slice land per frame, which would leave about 700 rows.
    for (let i = 0; i < 20 && result.current.length < 1000; i++) tick();
    expect(result.current).toHaveLength(1000);
    expect(result.current[0]!.id).toBe('m0');
    unmount();
  });

  it('grows the layout step so a medium tail still fills the viewport in the first commit', () => {
    const rows = make(400);
    const { use } = sized(4, 800);
    const { result } = renderHook(() => use(rows));
    expect(result.current.length).toBeGreaterThanOrEqual(200);
  });
});
