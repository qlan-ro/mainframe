/**
 * useZonesReconciler — the invariant "while split, the focused chat is one of
 * the two zones". The hook watches `mainThreadId` (aui's single focus axis) and
 * reacts three ways: a switch INTO the split moves focus, a switch OUTSIDE it
 * retargets the focused slot, and a switch to an unsent draft ends the split.
 *
 * aui is mocked down to the one field the hook reads, driven by a module-scope
 * variable + rerender — the same seam the session-tabs suites use.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('switching to a chat outside the split', () => {
  it('replaces the LEFT zone when the left slot has focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-c';
    rerender();

    expect(zones()).toEqual(['chat-c', 'chat-b']);
    expect(focusedIndex()).toBe(0);
  });

  it('replaces the RIGHT zone when the right slot has focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = 'chat-c';
    rerender();

    expect(zones()).toEqual(['chat-a', 'chat-c']);
    expect(focusedIndex()).toBe(1);
  });
});

describe('switching to an unsent draft', () => {
  it('closes the split — the welcome flow owns the whole surface', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useZonesReconciler());

    mainThreadIdValue = '__LOCALID_7';
    rerender();

    expect(zones()).toBeNull();
    expect(focusedIndex()).toBe(0);
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
