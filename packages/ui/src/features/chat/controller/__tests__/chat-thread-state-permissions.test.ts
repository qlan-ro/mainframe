/**
 * Behavior tests for `reduceChatThreadState` — permission.requested /
 * permission.resolved, focused on removal of a non-front entry (todo #284).
 *
 * All expected values are hardcoded; no logic from the reducer or from
 * `selectPermissionFront` is re-derived here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ControlRequest } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../chat-thread-state';
import { selectPermissionFront } from '../../gates/select-front';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-xyz';

function makeRequest(id: string): ControlRequest {
  return { requestId: id, toolName: 'Bash', toolUseId: `tu-${id}`, input: {}, suggestions: [] };
}

/** Seed state with r1, r2, r3 requested in that order, each at a distinct askedAt tick. */
function stateWithThree(): ChatThreadState {
  let state = createChatThreadState(CHAT_ID);
  for (const id of ['r1', 'r2', 'r3']) {
    state = reduceChatThreadState(state, {
      type: 'permission.requested',
      requestId: id,
      request: makeRequest(id),
      options: [],
    });
    vi.advanceTimersByTime(1);
  }
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// permission.resolved — non-front removal
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — permission.resolved', () => {
  it('removes only the named permission and leaves the others in place', () => {
    const before = stateWithThree();
    const r1Before = before.interactions.permissions['r1'];
    const r3Before = before.interactions.permissions['r3'];

    const after = reduceChatThreadState(before, { type: 'permission.resolved', requestId: 'r2' });

    expect(Object.keys(after.interactions.permissions).sort()).toEqual(['r1', 'r3']);
    expect(after.interactions.permissions['r1']).toBe(r1Before);
    expect(after.interactions.permissions['r3']).toBe(r3Before);
  });

  it('resolving the front leaves the rest presentable', () => {
    const before = stateWithThree();

    const after = reduceChatThreadState(before, { type: 'permission.resolved', requestId: 'r1' });

    const front = selectPermissionFront(after.interactions.permissions);
    expect(front?.requestId).toBe('r2');
  });

  it('resolving an unknown requestId leaves the map untouched', () => {
    const before = stateWithThree();

    const after = reduceChatThreadState(before, { type: 'permission.resolved', requestId: 'ghost' });

    expect(after.interactions.permissions).toEqual(before.interactions.permissions);
    expect(Object.keys(after.interactions.permissions).sort()).toEqual(['r1', 'r2', 'r3']);
  });
});
