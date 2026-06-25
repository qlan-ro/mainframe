/**
 * Behavior tests for `reduceChatThreadState` — queued.snapshot and
 * queued.cancel_failed branches (fix #4).
 *
 * All tests use a fixed seed state and hardcoded expected values.
 * No logic from the reducer is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-xyz';

function makeRef(uuid: string): QueuedMessageRef {
  // QueuedMessageRef has at minimum uuid and content; we pin a minimal shape.
  return { uuid, content: `msg-${uuid}` } as unknown as QueuedMessageRef;
}

// Seed state with a stale item C already in interactions.queued.
function stateWithC() {
  const base = createChatThreadState(CHAT_ID);
  return reduceChatThreadState(base, { type: 'queued.added', ref: makeRef('C') });
}

// ---------------------------------------------------------------------------
// queued.snapshot — replaces the entire queued map
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — queued.snapshot', () => {
  it('replaces stale queued entries with only the snapshot refs', () => {
    const before = stateWithC();
    // Precondition: C is present before snapshot.
    expect(Object.keys(before.interactions.queued)).toEqual(['C']);

    const after = reduceChatThreadState(before, {
      type: 'queued.snapshot',
      refs: [makeRef('A'), makeRef('B')],
    });

    // After snapshot, queued must contain exactly A and B — C is gone.
    expect(Object.keys(after.interactions.queued).sort()).toEqual(['A', 'B']);
  });

  it('stores each ref keyed by its uuid', () => {
    const base = createChatThreadState(CHAT_ID);
    const after = reduceChatThreadState(base, {
      type: 'queued.snapshot',
      refs: [makeRef('A'), makeRef('B')],
    });

    expect(after.interactions.queued['A']).toEqual(makeRef('A'));
    expect(after.interactions.queued['B']).toEqual(makeRef('B'));
  });

  it('produces an empty queued map when the snapshot is empty', () => {
    const before = stateWithC();
    const after = reduceChatThreadState(before, {
      type: 'queued.snapshot',
      refs: [],
    });

    expect(Object.keys(after.interactions.queued)).toHaveLength(0);
  });

  it('does not mutate any other state slice', () => {
    const before = stateWithC();
    const after = reduceChatThreadState(before, {
      type: 'queued.snapshot',
      refs: [makeRef('A')],
    });

    expect(after.chatId).toBe(CHAT_ID);
    expect(after.runState).toBe(before.runState);
    expect(after.loadState).toBe(before.loadState);
    expect(after.messagesById).toBe(before.messagesById);
    expect(after.pendingUserMessages).toBe(before.pendingUserMessages);
  });
});

// ---------------------------------------------------------------------------
// queued.cancel_failed — queued map is left unchanged
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — queued.cancel_failed', () => {
  it('leaves interactions.queued unchanged when the cancel fails', () => {
    const before = stateWithC();
    const after = reduceChatThreadState(before, {
      type: 'queued.cancel_failed',
      uuid: 'C',
    });

    // C remains in the queued map — the cancel did not succeed.
    expect(Object.keys(after.interactions.queued)).toEqual(['C']);
    expect(after.interactions.queued['C']).toEqual(makeRef('C'));
  });

  it('returns the same state reference (no allocation) for cancel_failed', () => {
    const before = stateWithC();
    const after = reduceChatThreadState(before, {
      type: 'queued.cancel_failed',
      uuid: 'C',
    });

    // The reducer explicitly returns `state` — reference equality confirms no copy.
    expect(after).toBe(before);
  });

  it('does not remove a queued entry that was NOT the failing uuid', () => {
    const base = createChatThreadState(CHAT_ID);
    const withTwo = reduceChatThreadState(reduceChatThreadState(base, { type: 'queued.added', ref: makeRef('X') }), {
      type: 'queued.added',
      ref: makeRef('Y'),
    });

    const after = reduceChatThreadState(withTwo, {
      type: 'queued.cancel_failed',
      uuid: 'X',
    });

    expect(Object.keys(after.interactions.queued).sort()).toEqual(['X', 'Y']);
  });
});
