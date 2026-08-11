/**
 * zones-store — the split's whole state: the two visible chats and which slot
 * has focus. Two rules carry it: `replaceZone` never lets the same chat hold
 * both slots (a duplicate-zone state would mount one controller twice), and
 * opening or closing the split always parks focus on the left slot.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isVisibleZone, useZonesStore } from '../zones-store';

const state = () => useZonesStore.getState();

beforeEach(() => {
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('openSplit', () => {
  it('puts the two chats left-to-right in the order given', () => {
    state().openSplit('chat-a', 'chat-b');

    expect(state().zones).toEqual(['chat-a', 'chat-b']);
  });

  it('focuses the left slot, even when the right slot was focused before', () => {
    useZonesStore.setState({ zones: ['chat-x', 'chat-y'], focusedIndex: 1 });

    state().openSplit('chat-a', 'chat-b');

    expect(state().focusedIndex).toBe(0);
  });
});

describe('replaceZone', () => {
  it('replaces the left slot and keeps the right one', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    state().replaceZone(0, 'chat-c');

    expect(state().zones).toEqual(['chat-c', 'chat-b']);
  });

  it('replaces the right slot and keeps the left one', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    state().replaceZone(1, 'chat-c');

    expect(state().zones).toEqual(['chat-a', 'chat-c']);
  });

  it('leaves focus where it was', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });

    state().replaceZone(0, 'chat-c');

    expect(state().focusedIndex).toBe(1);
  });

  it('does nothing when there is no split', () => {
    useZonesStore.setState({ zones: null, focusedIndex: 1 });

    state().replaceZone(0, 'chat-c');

    expect(state().zones).toBeNull();
    expect(state().focusedIndex).toBe(1);
  });

  it('does nothing when the chat already holds the OTHER slot', () => {
    // The duplicate-zone guard: dropping b into slot 0 would leave ['b','b'].
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    state().replaceZone(0, 'chat-b');

    expect(state().zones).toEqual(['chat-a', 'chat-b']);
  });

  it('does nothing when the chat already holds the target slot', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    state().replaceZone(0, 'chat-a');

    expect(state().zones).toEqual(['chat-a', 'chat-b']);
  });
});

describe('setFocusedIndex', () => {
  it('moves focus to the right slot without touching the pair', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    state().setFocusedIndex(1);

    expect(state().focusedIndex).toBe(1);
    expect(state().zones).toEqual(['chat-a', 'chat-b']);
  });
});

describe('closeSplit', () => {
  it('drops the pair and parks focus back on the left slot', () => {
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });

    state().closeSplit();

    expect(state().zones).toBeNull();
    expect(state().focusedIndex).toBe(0);
  });
});

describe('isVisibleZone', () => {
  it('is true for each of the two split members', () => {
    expect(isVisibleZone(['chat-a', 'chat-b'], 'chat-a')).toBe(true);
    expect(isVisibleZone(['chat-a', 'chat-b'], 'chat-b')).toBe(true);
  });

  it('is false for a chat outside the split', () => {
    expect(isVisibleZone(['chat-a', 'chat-b'], 'chat-c')).toBe(false);
  });

  it('is false for every chat when there is no split', () => {
    expect(isVisibleZone(null, 'chat-a')).toBe(false);
  });

  it('is false when there is no focused chat id', () => {
    expect(isVisibleZone(['chat-a', 'chat-b'], null)).toBe(false);
    expect(isVisibleZone(['chat-a', 'chat-b'], undefined)).toBe(false);
    expect(isVisibleZone(null, null)).toBe(false);
  });
});
