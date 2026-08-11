/**
 * openInSplit — the shared ⌘-click / context-menu gesture, seen through its
 * RETURN VALUE: true means "the split absorbed this", and every caller then
 * skips its plain focus switch. False means fall through to a normal switch.
 *
 * The call sites are covered end to end in
 * features/session-tabs/__tests__/SessionTabs.split.test.tsx; this suite pins
 * the contract itself, which the callers only observe indirectly.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openInSplit } from '../open-in-split';
import { useZonesStore } from '../zones-store';

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;

beforeEach(() => {
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('gestures the split cannot express', () => {
  it('falls through with no active chat to split against', () => {
    expect(openInSplit(null, 'chat-b')).toBe(false);
    expect(zones()).toBeNull();
  });

  it('falls through on the active chat itself', () => {
    expect(openInSplit('chat-a', 'chat-a')).toBe(false);
    expect(zones()).toBeNull();
  });

  it('falls through on an unsent draft — a draft cannot be a zone', () => {
    expect(openInSplit('chat-a', '__LOCALID_1')).toBe(false);
    expect(zones()).toBeNull();
  });

  it('falls through when the active chat is an unsent draft', () => {
    expect(openInSplit('__LOCALID_1', 'chat-b')).toBe(false);
    expect(zones()).toBeNull();
  });

  it('falls through on a chat already visible in the split — that is a focus click', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    expect(openInSplit('chat-a', 'chat-b')).toBe(false);
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });
});

describe('gestures the split absorbs', () => {
  it('opens the split with the active chat on the left', () => {
    expect(openInSplit('chat-a', 'chat-b')).toBe(true);
    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(focusedIndex()).toBe(0);
  });

  it('retargets the RIGHT slot while the left one has focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    expect(openInSplit('chat-a', 'chat-c')).toBe(true);
    expect(zones()).toEqual(['chat-a', 'chat-c']);
    expect(focusedIndex()).toBe(0);
  });

  it('retargets the LEFT slot while the right one has focus', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });

    expect(openInSplit('chat-b', 'chat-c')).toBe(true);
    expect(zones()).toEqual(['chat-c', 'chat-b']);
    expect(focusedIndex()).toBe(1);
  });
});
