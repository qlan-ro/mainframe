/**
 * Queued-turn projection cases for `projectChatThreadMessages` (D1, T32) —
 * split out of `project-messages.test.ts` (todo #350, plan task 37, R2.13)
 * to keep that file under the 300-line cap.
 */
import { describe, it, expect } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';
import { projectChatThreadMessages } from '../project-messages';

function textMessage(id: string, role: ThreadMessageLike['role'], text: string): ThreadMessageLike {
  return { id, role, content: [{ type: 'text', text }] } as ThreadMessageLike;
}

function queuedRef(overrides: Partial<QueuedMessageRef> = {}): QueuedMessageRef {
  return {
    messageId: 'm1',
    chatId: 'chat-1',
    uuid: 'u1',
    content: 'queued text',
    timestamp: '2026-09-14T00:00:01.000Z',
    ...overrides,
  };
}

function stateWithQueued(refs: QueuedMessageRef[]) {
  return reduceChatThreadState(createChatThreadState('chat-1'), { type: 'queued.snapshot', refs });
}

describe('projectChatThreadMessages — queued turns (D1, T32)', () => {
  it('queued refs project as queued turns, in timestamp order, at the tail', () => {
    const refs = [
      queuedRef({ messageId: 'm2', uuid: 'u2', content: 'second', timestamp: '2026-09-14T00:00:02.000Z' }),
      queuedRef({ messageId: 'm1', uuid: 'u1', content: 'first', timestamp: '2026-09-14T00:00:01.000Z' }),
    ];
    const state = stateWithQueued(refs);

    const messages = projectChatThreadMessages(state);

    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.content)).toEqual([
      [{ type: 'text', text: 'first' }],
      [{ type: 'text', text: 'second' }],
    ]);
    for (const m of messages) {
      expect(m.role).toBe('user');
      expect((m.metadata as { custom: { mainframe: { queued: boolean } } }).custom.mainframe.queued).toBe(true);
    }
  });

  it('a dequeued ref does not render twice once the server message it became is in state.messages', () => {
    const server = textMessage('m1', 'user', 'first');
    let state = reduceChatThreadState(createChatThreadState('chat-1'), {
      type: 'transcript.updated',
      messages: [server],
    });
    state = reduceChatThreadState(state, {
      type: 'queued.snapshot',
      refs: [queuedRef({ messageId: 'm1', uuid: 'u1', content: 'first' })],
    });

    const messages = projectChatThreadMessages(state);

    expect(messages.filter((m) => m.id === 'm1')).toHaveLength(1);
  });
});
