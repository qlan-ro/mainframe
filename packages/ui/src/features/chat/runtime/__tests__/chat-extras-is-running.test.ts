/**
 * `isRunningFromState` — the one place this derivation lives now (D7,
 * finding 9; long-chat-and-streaming plan task U3), folded out of
 * `ChatZone.tsx` and `SideChatPanel.tsx`.
 */
import { describe, it, expect } from 'vitest';
import type { ControlRequest } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../../controller/chat-thread-state';
import { isRunningFromState } from '../chat-extras';

const CHAT_ID = 'chat-xyz';

function makeRequest(id: string): ControlRequest {
  return { requestId: id, toolName: 'Bash', toolUseId: `tu-${id}`, input: {}, suggestions: [] };
}

describe('isRunningFromState', () => {
  it('is true while running, false while idle', () => {
    let state = createChatThreadState(CHAT_ID);
    expect(isRunningFromState(state)).toBe(false);

    state = reduceChatThreadState(state, { type: 'run.started' });
    expect(isRunningFromState(state)).toBe(true);

    state = reduceChatThreadState(state, { type: 'run.stopped' });
    expect(isRunningFromState(state)).toBe(false);
  });

  it('is true while cancelling', () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'run.started' });
    state = reduceChatThreadState(state, { type: 'run.cancelling' });

    expect(isRunningFromState(state)).toBe(true);
  });

  it('a pending permission gate makes it false, even while the turn is running', () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'run.started' });
    state = reduceChatThreadState(state, {
      type: 'permission.requested',
      requestId: 'r1',
      request: makeRequest('r1'),
      options: [],
    });

    expect(isRunningFromState(state)).toBe(false);
  });

  it('resolving the gate restores the running status', () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'run.started' });
    state = reduceChatThreadState(state, {
      type: 'permission.requested',
      requestId: 'r1',
      request: makeRequest('r1'),
      options: [],
    });
    state = reduceChatThreadState(state, { type: 'permission.resolved', requestId: 'r1' });

    expect(isRunningFromState(state)).toBe(true);
  });
});
