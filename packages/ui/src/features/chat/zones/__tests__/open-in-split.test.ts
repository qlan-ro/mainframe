/**
 * openInSplit — the shared ⌘-click / context-menu gesture, seen through its
 * RETURN VALUE: true means "the split absorbed this", and every caller then
 * skips its plain focus switch. False means fall through to a normal switch.
 *
 * The call sites are covered end to end in
 * features/session-tabs/__tests__/SessionTabs.split.test.tsx; this suite pins
 * the contract itself, which the callers only observe indirectly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openBeside, openInSplit } from '../open-in-split';
import { useZonesStore } from '../zones-store';
import { __resetSideChatRegistryForTests, registerSideChat } from '@/features/side-chat/side-chat-ids';

const zones = () => useZonesStore.getState().zones;
const focusedIndex = () => useZonesStore.getState().focusedIndex;

beforeEach(() => {
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

afterEach(() => {
  __resetSideChatRegistryForTests();
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

  it('falls through on a registered side-chat id — it lives in its parent’s zone, not its own (todo #344)', () => {
    registerSideChat('chat-side-1', 'chat-a');

    expect(openInSplit('chat-a', 'chat-side-1')).toBe(false);
    expect(zones()).toBeNull();
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

describe('openBeside — pair a chat with an anchor, e.g. a fork with its parent', () => {
  it('opens a fresh pair with the anchor left when there is none', () => {
    openBeside('parent', 'fork');
    expect(zones()).toEqual(['parent', 'fork']);
  });

  it('replaces a pair that does not hold the anchor', () => {
    useZonesStore.setState({ zones: ['chat-x', 'chat-y'], focusedIndex: 1 });
    openBeside('parent', 'fork');
    expect(zones()).toEqual(['parent', 'fork']);
  });

  it("keeps the anchor's slot and swaps the other one", () => {
    useZonesStore.setState({ zones: ['chat-x', 'parent'], focusedIndex: 1 });
    openBeside('parent', 'fork');
    expect(zones()).toEqual(['fork', 'parent']);
  });

  it('leaves a pair that already shows both untouched', () => {
    useZonesStore.setState({ zones: ['parent', 'fork'], focusedIndex: 0 });
    openBeside('parent', 'fork');
    expect(zones()).toEqual(['parent', 'fork']);
  });
});
