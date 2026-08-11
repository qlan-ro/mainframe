/**
 * useZoneHotkeys — ⌘\ / Ctrl+\ closes the VISIBLE split's focused zone,
 * leaving the other chat on the whole surface. Observable outcome: the zones
 * store collapses and aui is switched to the SURVIVOR (the zone that did NOT
 * have focus). A PARKED pair (main outside the split) is not what the
 * shortcut aims at, so it stays inert.
 *
 * The aui client is an argument; `useAuiState` (the main-thread read the
 * visibility gate needs) is the one module mock.
 */
import { fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { useAui } from '@assistant-ui/react';

let mainThreadIdValue: string | null = null;
vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAuiState: (sel: (s: { threads: { mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { mainThreadId: mainThreadIdValue } }),
  };
});

import { useZonesStore } from '../zones-store';
import { useZoneHotkeys } from '../use-zone-hotkeys';

const switchToThread = vi.fn();
const aui = { threads: { switchToThread } } as unknown as ReturnType<typeof useAui>;

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;

/** Returns false when the handler called preventDefault. */
const pressCmdBackslash = () => fireEvent.keyDown(window, { key: '\\', metaKey: true });

beforeEach(() => {
  switchToThread.mockReset();
  mainThreadIdValue = 'chat-a';
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('while the surface is split', () => {
  it('closes the split and lands on the RIGHT chat when the left zone has focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZoneHotkeys(aui));

    pressCmdBackslash();

    expect(zones()).toBeNull();
    expect(focusedIndex()).toBe(0);
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
  });

  it('closes the split and lands on the LEFT chat when the right zone has focus', () => {
    mainThreadIdValue = 'chat-b';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    renderHook(() => useZoneHotkeys(aui));

    pressCmdBackslash();

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-a');
  });

  it('takes the keystroke away from the browser', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZoneHotkeys(aui));

    expect(pressCmdBackslash()).toBe(false);
  });

  it('answers Ctrl+\\ the same way (Windows / Linux)', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZoneHotkeys(aui));

    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
  });
});

describe('inert cases', () => {
  it('does nothing with no split open', () => {
    renderHook(() => useZoneHotkeys(aui));

    expect(pressCmdBackslash()).toBe(true);
    expect(zones()).toBeNull();
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('stays inert on a PARKED pair — main is outside the split', () => {
    mainThreadIdValue = 'chat-elsewhere';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZoneHotkeys(aui));

    expect(pressCmdBackslash()).toBe(true);
    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('ignores a bare backslash — it is a character, not a command', () => {
    mainThreadIdValue = 'chat-b';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    renderHook(() => useZoneHotkeys(aui));

    fireEvent.keyDown(window, { key: '\\' });

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(1);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('ignores ⌘ with another key', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    renderHook(() => useZoneHotkeys(aui));

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('stops listening once the surface unmounts', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = renderHook(() => useZoneHotkeys(aui));

    unmount();
    pressCmdBackslash();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(switchToThread).not.toHaveBeenCalled();
  });
});
