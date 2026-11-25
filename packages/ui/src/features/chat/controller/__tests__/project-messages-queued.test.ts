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

describe('projectChatThreadMessages — steered turns (D1, C9, C10)', () => {
  it('plain queued refs are composer rows, not transcript messages', () => {
    const state = stateWithQueued([queuedRef({ messageId: 'm1' }), queuedRef({ messageId: 'm2', uuid: 'u2' })]);

    expect(projectChatThreadMessages(state)).toEqual([]);
  });

  it('steered refs project as user turns in timestamp order at the tail, flagged steered', () => {
    const state = stateWithQueued([
      queuedRef({
        messageId: 'm2',
        uuid: 'u2',
        content: 'second',
        timestamp: '2026-09-14T00:00:02.000Z',
        steered: true,
      }),
      queuedRef({
        messageId: 'm1',
        uuid: 'u1',
        content: 'first',
        timestamp: '2026-09-14T00:00:01.000Z',
        steered: true,
      }),
    ]);

    const messages = projectChatThreadMessages(state);

    expect(messages.map((m) => m.content)).toEqual([
      [{ type: 'text', text: 'first' }],
      [{ type: 'text', text: 'second' }],
    ]);
    for (const m of messages) {
      expect(m.role).toBe('user');
      expect(m.metadata?.custom?.mainframe).toMatchObject({ queued: true, steered: true });
    }
  });

  it('a steered row mixed with a plain queued one projects only the steered one', () => {
    const state = stateWithQueued([
      queuedRef({ messageId: 'm1', content: 'later' }),
      queuedRef({ messageId: 'm2', uuid: 'u2', content: 'now', steered: true }),
    ]);

    expect(projectChatThreadMessages(state).map((m) => m.id)).toEqual(['m2']);
  });

  it('a dequeued steered ref does not render twice once the server message it became is in state.messages', () => {
    const server = textMessage('m1', 'user', 'first');
    let state = reduceChatThreadState(createChatThreadState('chat-1'), {
      type: 'transcript.updated',
      messages: [server],
    });
    state = reduceChatThreadState(state, {
      type: 'queued.snapshot',
      refs: [queuedRef({ messageId: 'm1', uuid: 'u1', content: 'first', steered: true })],
    });

    const messages = projectChatThreadMessages(state);

    expect(messages.filter((m) => m.id === 'm1')).toHaveLength(1);
  });
});

describe('pending sends behind a running turn', () => {
  const pendingBase = { clientId: 'p1', chatId: 'chat-1', text: 'later', createdAt: 1 } as const;

  it('a pending send marked queueing is hidden until it fails', () => {
    const pending = reduceChatThreadState(createChatThreadState('chat-1'), {
      type: 'local.message.queued',
      pending: { ...pendingBase, status: 'pending', queueing: true },
    });
    expect(projectChatThreadMessages(pending)).toEqual([]);

    const failed = reduceChatThreadState(createChatThreadState('chat-1'), {
      type: 'local.message.queued',
      pending: { ...pendingBase, status: 'failed', queueing: true, error: 'boom' },
    });
    expect(projectChatThreadMessages(failed).map((m) => m.id)).toEqual(['local:p1']);
  });

  it('a pending steer shows at once, flagged steered', () => {
    const state = reduceChatThreadState(createChatThreadState('chat-1'), {
      type: 'local.message.queued',
      pending: { ...pendingBase, status: 'pending', sendMeta: { steer: true } },
    });

    const [message] = projectChatThreadMessages(state);

    expect(message?.id).toBe('local:p1');
    expect(message?.metadata?.custom?.mainframe).toMatchObject({ pending: true, steered: true });
  });

  it('a plain pending send is not flagged steered', () => {
    const state = reduceChatThreadState(createChatThreadState('chat-1'), {
      type: 'local.message.queued',
      pending: { ...pendingBase, status: 'pending' },
    });

    expect(projectChatThreadMessages(state)[0]?.metadata?.custom?.mainframe).not.toHaveProperty('steered');
  });
});
