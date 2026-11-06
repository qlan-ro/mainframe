import { expect, it } from 'vitest';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

it('keeps the daemon turn start through repeat starts and cancelling, and drops it at idle', () => {
  let state = reduceChatThreadState(createChatThreadState('chat'), { type: 'run.started', startedAtMs: 5_000 });
  expect(state.runState).toEqual({ type: 'running', startedAtMs: 5_000 });
  state = reduceChatThreadState(state, { type: 'run.started' });
  expect(state.runState).toEqual({ type: 'running', startedAtMs: 5_000 });
  state = reduceChatThreadState(state, { type: 'run.cancelling' });
  expect(state.runState).toEqual({ type: 'cancelling', startedAtMs: 5_000 });
  state = reduceChatThreadState(state, { type: 'run.stopped' });
  expect(state.runState).toEqual({ type: 'idle' });
  expect(reduceChatThreadState(state, { type: 'run.started' }).runState).toEqual({ type: 'running' });
});
