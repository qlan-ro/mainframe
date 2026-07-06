import { describe, it, expect, beforeEach } from 'vitest';
import { useUnreadStore } from '../unread-store';

// Reset the singleton store between tests so each test starts with a clean slate.
beforeEach(() => {
  useUnreadStore.setState({ unread: new Set() });
});

// ---------------------------------------------------------------------------
// unread-store — initial state
// ---------------------------------------------------------------------------

describe('unread-store — initial state is empty', () => {
  it('has an empty unread set on first import', () => {
    expect(useUnreadStore.getState().unread.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// unread-store — markUnread adds an id
// ---------------------------------------------------------------------------

describe('unread-store — markUnread adds an id', () => {
  it('adds the id to unread and sets size to 1', () => {
    useUnreadStore.getState().markUnread('chat-abc');
    expect(useUnreadStore.getState().unread.has('chat-abc')).toBe(true);
    expect(useUnreadStore.getState().unread.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// unread-store — isUnread selector
// ---------------------------------------------------------------------------

describe('unread-store — isUnread returns true for a marked id, false for others', () => {
  it('returns true for the marked id and false for an unmarked id', () => {
    useUnreadStore.getState().markUnread('chat-abc');
    expect(useUnreadStore.getState().isUnread('chat-abc')).toBe(true);
    expect(useUnreadStore.getState().isUnread('chat-xyz')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unread-store — clearUnread removes an id
// ---------------------------------------------------------------------------

describe('unread-store — clearUnread removes a previously marked id', () => {
  it('removes the id so has returns false and size returns 0', () => {
    useUnreadStore.getState().markUnread('chat-abc');
    useUnreadStore.getState().clearUnread('chat-abc');
    expect(useUnreadStore.getState().unread.has('chat-abc')).toBe(false);
    expect(useUnreadStore.getState().unread.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// unread-store — clearUnread on never-marked id is a no-op
// ---------------------------------------------------------------------------

describe('unread-store — clearUnread on a never-marked id is a no-op', () => {
  it('does not throw and leaves size at 0', () => {
    expect(() => {
      useUnreadStore.getState().clearUnread('never-existed');
    }).not.toThrow();
    expect(useUnreadStore.getState().unread.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// unread-store — marking the same id twice does not grow the set
// ---------------------------------------------------------------------------

describe('unread-store — marking the same id twice does not grow the set past 1', () => {
  it('size remains 1 after two markUnread calls with the same id', () => {
    useUnreadStore.getState().markUnread('chat-dup');
    useUnreadStore.getState().markUnread('chat-dup');
    expect(useUnreadStore.getState().unread.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// unread-store — multiple ids are tracked independently
// ---------------------------------------------------------------------------

describe('unread-store — multiple ids are tracked independently', () => {
  it('tracks two ids separately and clearUnread on one leaves the other intact', () => {
    useUnreadStore.getState().markUnread('a');
    useUnreadStore.getState().markUnread('b');

    expect(useUnreadStore.getState().unread.size).toBe(2);
    expect(useUnreadStore.getState().isUnread('a')).toBe(true);
    expect(useUnreadStore.getState().isUnread('b')).toBe(true);

    useUnreadStore.getState().clearUnread('a');

    expect(useUnreadStore.getState().unread.size).toBe(1);
    expect(useUnreadStore.getState().isUnread('a')).toBe(false);
    expect(useUnreadStore.getState().isUnread('b')).toBe(true);
  });
});
