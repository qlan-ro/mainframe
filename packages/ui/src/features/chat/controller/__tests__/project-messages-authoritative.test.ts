import { expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../chat-thread-state';
import { projectChatThreadMessages, projectChatThreadRepository } from '../project-messages';

const assistant = (id = 'old'): ThreadMessageLike => ({ id, role: 'assistant', content: [{ type: 'text', text: id }] });
const user = (id = 'echo'): ThreadMessageLike => ({ id, role: 'user', content: [{ type: 'text', text: id }] });
function stateFor(messages: ThreadMessageLike[], phase: 'running' | 'cancelling' | 'idle' = 'running') {
  let state = createChatThreadState('chat');
  state = reduceChatThreadState(state, { type: 'capabilities.updated', authoritativeItemStreaming: true });
  state = reduceChatThreadState(state, { type: 'transcript.updated', messages });
  return reduceChatThreadState(state, {
    type: phase === 'idle' ? 'run.stopped' : phase === 'cancelling' ? 'run.cancelling' : 'run.started',
  });
}
function withPending(state: ChatThreadState) {
  return reduceChatThreadState(state, {
    type: 'local.message.queued',
    pending: {
      clientId: 'next',
      chatId: 'chat',
      text: 'next prompt',
      createdAt: 1,
      status: 'pending',
    },
  });
}

it.each(['running', 'cancelling', 'idle'] as const)(
  'settles missing assistant status during %s without mutating parts or input',
  (phase) => {
    const old = assistant();
    const echo = user();
    const state = stateFor([old, echo], phase);
    const projected = projectChatThreadMessages(state);
    expect(projected.map((message) => message.id)).toEqual(['old', 'echo']);
    expect(projected[0]!.status).toEqual({ type: 'complete', reason: 'unknown' });
    expect(projected[0]!.content).toBe(old.content);
    expect(old.status).toBeUndefined();
    expect(projected[1]).toBe(echo);
    expect(projected[1]).not.toHaveProperty('status');
  },
);
it('keeps the previous answer complete while an optimistic prompt is pending in arrays and repositories', () => {
  const state = withPending(stateFor([assistant()]));
  const messages = projectChatThreadMessages(state);
  expect(messages[0]!.status?.type).toBe('complete');
  expect(messages[1]).toMatchObject({ id: 'local:next', role: 'user' });
  expect(messages[1]).not.toHaveProperty('status');
  const repository = projectChatThreadRepository(state);
  expect(repository.messages.map(({ message }) => message.id)).toEqual(['old', 'local:next']);
  expect(repository.messages[0]!.message.status?.type).toBe('complete');
});
it.each([
  { type: 'running' as const },
  { type: 'complete' as const, reason: 'stop' as const },
  { type: 'incomplete' as const, reason: 'cancelled' as const },
])('preserves explicit assistant status %j behind a later user acknowledgment', (status) => {
  const explicit: ThreadMessageLike = { ...assistant('new'), status };
  const projected = projectChatThreadMessages(stateFor([assistant(), explicit, user()]));
  expect(projected[0]!.status?.type).toBe('complete');
  expect(projected[1]).toBe(explicit);
  expect(projected[1]!.status).toBe(status);
  expect(projected[2]).not.toHaveProperty('status');
});
it('does not assign status when the transcript has only user and system messages', () => {
  const messages: ThreadMessageLike[] = [user(), { id: 'system', role: 'system', content: 'notice' }];
  expect(projectChatThreadMessages(stateFor(messages))).toEqual(messages);
  expect(projectChatThreadMessages(stateFor([]))).toEqual([]);
});
it('restores the legacy acknowledgment fallback after a negotiated downgrade', () => {
  const current = stateFor([assistant(), user()]);
  const legacy = reduceChatThreadState(current, { type: 'capabilities.updated', authoritativeItemStreaming: false });
  expect(projectChatThreadMessages(current)[0]!.status?.type).toBe('complete');
  expect(projectChatThreadMessages(legacy)[0]!.status?.type).toBe('running');
});
