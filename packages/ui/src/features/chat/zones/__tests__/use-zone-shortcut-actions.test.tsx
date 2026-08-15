/**
 * The chat surface's split shortcuts, mounted the way ChatSurface mounts them:
 * the app dispatcher plus `useZoneShortcutActions`.
 *
 * ⌘\ closes the VISIBLE split and leaves the other chat on the whole surface —
 * the zones store collapses and aui switches to the SURVIVOR (the zone that did
 * NOT have focus). A PARKED pair (main outside the split) is not what the
 * shortcut aims at, so it stays inert. ⌘⇧\ is the keyboard twin of the tab
 * strip's open-in-split: it walks the displayed tab order for the first
 * partner `canOpenInSplit` accepts, so the two gestures can never disagree.
 */
import { fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantClient } from '@assistant-ui/react';

// jsdom reports a Linux-ish platform, so `mod` would resolve to Ctrl and the ⌘
// cases would miss. The dispatcher reads this once at mount.
let isMac = true;
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => isMac }));

import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';
import { useSessionTabsStore } from '@/features/session-tabs/store';
import { useZonesStore } from '../zones-store';
import { useZoneShortcutActions } from '../use-zone-shortcut-actions';

const switchToThread = vi.fn();
let mainThreadId: string | null = 'chat-a';
let threadItems: { id: string; status: string }[] = [];

const aui = {
  threads: {
    switchToThread,
    getState: () => ({ mainThreadId, threadItems }),
  },
} as unknown as AssistantClient;

function mountZoneShortcuts() {
  return renderHook(() => {
    useShortcutDispatcher();
    useZoneShortcutActions(aui);
  });
}

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;

/**
 * Returns false when the shortcut took the keystroke from the browser. The
 * dispatcher prevents the default for any REGISTERED id, so an inert case is
 * asserted on the store state, not on `defaultPrevented` — the chord belongs
 * to the app whether or not this press had anywhere to go.
 */
const pressCloseSplit = () => fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
const pressOpenInSplit = () =>
  fireEvent.keyDown(window, { key: '|', code: 'Backslash', metaKey: true, shiftKey: true });

/** Sessions in the strip, in displayed order, all of them real (not drafts). */
function openTabs(ids: string[]): void {
  useSessionTabsStore.setState({ tabIds: ids, previewId: null, draftId: null });
  threadItems = ids.map((id) => ({ id, status: 'regular' }));
}

beforeEach(() => {
  isMac = true;
  switchToThread.mockReset();
  mainThreadId = 'chat-a';
  openTabs([]);
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('⌘\\ — close the visible split', () => {
  it('closes the split and lands on the RIGHT chat when the left zone has focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = mountZoneShortcuts();

    pressCloseSplit();

    expect(zones()).toBeNull();
    expect(focusedIndex()).toBe(0);
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
    unmount();
  });

  it('closes the split and lands on the LEFT chat when the right zone has focus', () => {
    mainThreadId = 'chat-b';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    const { unmount } = mountZoneShortcuts();

    pressCloseSplit();

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-a');
    unmount();
  });

  it('takes the keystroke away from the browser', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = mountZoneShortcuts();

    expect(pressCloseSplit()).toBe(false);
    unmount();
  });

  it('answers Ctrl+\\ the same way off macOS', () => {
    isMac = false;
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = mountZoneShortcuts();

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', ctrlKey: true });

    expect(zones()).toBeNull();
    expect(switchToThread).toHaveBeenCalledWith('chat-b');
    unmount();
  });

  it('does nothing with no split open', () => {
    const { unmount } = mountZoneShortcuts();

    pressCloseSplit();

    expect(zones()).toBeNull();
    expect(switchToThread).not.toHaveBeenCalled();
    unmount();
  });

  it('stays inert on a PARKED pair — main is outside the split', () => {
    mainThreadId = 'chat-elsewhere';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = mountZoneShortcuts();

    pressCloseSplit();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(switchToThread).not.toHaveBeenCalled();
    unmount();
  });

  it('stops listening once the surface unmounts', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    mountZoneShortcuts().unmount();

    pressCloseSplit();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('⌘⇧\\ — open the next session in a split', () => {
  it('splits with the nearest following tab, matching the context-menu action', () => {
    openTabs(['chat-a', 'chat-b', 'chat-c']);
    const { unmount } = mountZoneShortcuts();

    pressOpenInSplit();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    unmount();
  });

  it('retargets the unfocused slot while a split is already visible', () => {
    openTabs(['chat-a', 'chat-b', 'chat-c']);
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = mountZoneShortcuts();

    pressOpenInSplit();

    expect(zones()).toEqual(['chat-a', 'chat-c']);
    unmount();
  });

  it('is inert with only one session open — no partner to split with', () => {
    openTabs(['chat-a']);
    const { unmount } = mountZoneShortcuts();

    pressOpenInSplit();

    expect(zones()).toBeNull();
    unmount();
  });

  it('is inert when the only two sessions are already the visible pair', () => {
    openTabs(['chat-a', 'chat-b']);
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { unmount } = mountZoneShortcuts();

    pressOpenInSplit();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    unmount();
  });

  it('is inert when the active session is an unsent draft — it cannot anchor a split', () => {
    mainThreadId = '__LOCALID_1';
    useSessionTabsStore.setState({ tabIds: ['chat-b'], previewId: null, draftId: '__LOCALID_1' });
    threadItems = [{ id: 'chat-b', status: 'regular' }];
    const { unmount } = mountZoneShortcuts();

    pressOpenInSplit();

    expect(zones()).toBeNull();
    unmount();
  });
});
