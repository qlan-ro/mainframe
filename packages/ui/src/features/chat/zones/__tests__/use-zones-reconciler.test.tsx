/**
 * useZonesReconciler — the invariant "while split, the focused chat is one of
 * the two zones". The hook watches `mainThreadId` (aui's single focus axis) and
 * reacts three ways: a switch INTO the split moves focus, a switch OUTSIDE it
 * retargets the focused slot, and a switch to an unsent draft ends the split.
 *
 * aui is mocked down to the one field the hook reads, driven by a module-scope
 * variable + rerender — the same seam the session-tabs suites use.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { useZonesStore } from '../zones-store';

let mainThreadIdValue: string | null;

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAuiState: (sel: (s: { threads: { mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { mainThreadId: mainThreadIdValue } }),
  };
});

import { useZonesReconciler } from '../use-zones-reconciler';

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;

beforeEach(() => {
  mainThreadIdValue = null;
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('switching to a chat already in the split', () => {
  it('moves focus to the right slot when the right zone becomes the focused chat', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-b';
    rerender();

    expect(focusedIndex()).toBe(1);
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });

  it('moves focus back to the left slot', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-a';
    rerender();

    expect(focusedIndex()).toBe(0);
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });
});

describe('switching to a chat outside the split — the pair PARKS', () => {
  it('never rewrites the pair, whichever slot had focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-c';
    rerender();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(0);
  });

  it('keeps the pair from the right slot too, and remembers its focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-c';
    rerender();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(1);
  });

  it('coming back to a member picks the split up where it was', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-c';
    rerender();
    mainThreadIdValue = 'chat-b';
    rerender();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(1);
  });
});

describe('switching to an unsent draft', () => {
  it('parks the pair like any other outside switch — the welcome flow shows alone', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = '__LOCALID_7';
    rerender();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(1);
  });
});

describe('with no split open', () => {
  it('leaves the store alone whatever the focused chat is', () => {
    useZonesStore.setState({ zones: null, focusedIndex: 1 });
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-c';
    rerender();

    expect(zones()).toBeNull();
    expect(focusedIndex()).toBe(1);
  });

  it('leaves the store alone with no focused chat at all', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    mainThreadIdValue = null;

    renderHook(() => useZonesReconciler());

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(1);
  });
});

/**
 * The workspace follower (split plan, decision 8). The layout mutators are
 * swapped for spies through the store itself, so this suite pins WHEN the
 * follower fires; what each mutator does to the layout lives in
 * store/__tests__/layout.chat-split.test.ts.
 */
describe('the workspace follows the split', () => {
  const realMove = useLayoutStore.getState().moveWorkspaceForChatSplit;
  const realRestore = useLayoutStore.getState().restoreWorkspaceAfterChatSplit;
  let move: ReturnType<typeof vi.fn<() => void>>;
  let restore: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    move = vi.fn();
    restore = vi.fn();
    useLayoutStore.setState({ moveWorkspaceForChatSplit: move, restoreWorkspaceAfterChatSplit: restore });
  });

  afterEach(() => {
    useLayoutStore.setState({
      moveWorkspaceForChatSplit: realMove,
      restoreWorkspaceAfterChatSplit: realRestore,
    });
  });

  it('parks the workspace when the split opens', () => {
    mainThreadIdValue = 'chat-a';
    renderHook(() => useZonesReconciler());
    expect(move).not.toHaveBeenCalled();

    act(() => {
      useZonesStore.getState().openSplit('chat-a', 'chat-b');
    });

    expect(move).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
  });

  it('restores the workspace when the split closes', () => {
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZonesReconciler());

    act(() => {
      useZonesStore.getState().closeSplit();
    });

    expect(restore).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1); // the mount itself entered the split
  });

  it('leaves the workspace alone while the split only swaps a zone', () => {
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZonesReconciler());
    move.mockClear();

    act(() => {
      useZonesStore.getState().replaceZone(1, 'chat-c');
    });

    expect(useZonesStore.getState().zones).toEqual(['chat-a', 'chat-c']);
    expect(move).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});
