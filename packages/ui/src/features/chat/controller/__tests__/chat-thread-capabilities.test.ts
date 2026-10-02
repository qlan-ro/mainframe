import { expect, it } from 'vitest';
import { createChatThreadState, reduceChatThreadState, type ChatStateEvent } from '../chat-thread-state';

it('defaults to legacy and preserves state identity for unchanged negotiated support', () => {
  const initial = createChatThreadState('chat');
  expect(initial.authoritativeItemStreaming).toBe(false);
  const legacy: ChatStateEvent = { type: 'capabilities.updated', authoritativeItemStreaming: false };
  expect(reduceChatThreadState(initial, legacy)).toBe(initial);
  const current = reduceChatThreadState(initial, { type: 'capabilities.updated', authoritativeItemStreaming: true });
  expect(current.authoritativeItemStreaming).toBe(true);
  expect(reduceChatThreadState(current, { type: 'capabilities.updated', authoritativeItemStreaming: true })).toBe(
    current,
  );
  expect(reduceChatThreadState(current, legacy).authoritativeItemStreaming).toBe(false);
  expect(initial.authoritativeItemStreaming).toBe(false);
});
it('preserves negotiated support through run, transcript, clear and chat identity updates', () => {
  let state = reduceChatThreadState(createChatThreadState('chat'), {
    type: 'capabilities.updated',
    authoritativeItemStreaming: true,
  });
  const events: ChatStateEvent[] = [
    { type: 'run.started' },
    { type: 'run.cancelling' },
    { type: 'transcript.updated', messages: [{ id: 'answer', role: 'assistant', content: 'done' }] },
    { type: 'history.ready' },
    { type: 'transcript.cleared' },
    { type: 'run.stopped' },
    { type: 'chat.id.adopted', chatId: 'remote' },
  ];
  for (const event of events) {
    state = reduceChatThreadState(state, event);
    expect(state.authoritativeItemStreaming).toBe(true);
  }
  expect(state.chatId).toBe('remote');
  expect(state.messages).toEqual([]);
  expect(state.runState.type).toBe('idle');
});
