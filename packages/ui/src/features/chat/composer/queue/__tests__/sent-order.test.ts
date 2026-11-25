// @vitest-environment jsdom
/** Where a held message stood before "Send now" queued it with the agent (C10). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { useHeldQueue } from '../held-queue-store';
import { forgetSent, heldTimestamp, matchQueued, noteQueued } from '../sent-order';

const CHAT = 'chat-1';
const ref = (messageId: string, second: number, content: string, attachmentIds?: string[]): QueuedMessageRef => ({
  messageId,
  chatId: CHAT,
  uuid: `u-${messageId}`,
  content,
  timestamp: `2026-11-24T11:00:0${second}.000Z`,
  ...(attachmentIds && { attachmentIds }),
});
const at = (id: string) => heldTimestamp(CHAT, id);

beforeEach(() => forgetSent(CHAT));

describe('a held message in the agent’s queue', () => {
  it('cannot take an older ref with the same text and attachments', () => {
    noteQueued(CHAT, { queuedMessageId: 'q2', timestamp: 't1' });
    matchQueued(CHAT, [ref('q1', 1, 'again'), ref('q2', 2, 'again')]);
    expect([at('q1'), at('q2')]).toEqual([undefined, 't1']);
  });

  it('keeps the timestamp when a queued row is edited', () => {
    noteQueued(CHAT, { queuedMessageId: 'q1', timestamp: 't1' });
    matchQueued(CHAT, [ref('q1', 1, 'B')]);
    matchQueued(CHAT, [ref('q1', 1, 'B, reworded')]);

    expect(at('q1')).toBe('t1');
    expect(at('q2')).toBeUndefined();
  });

  it('keeps two with the same text in their order, whatever order the queue is listed in', () => {
    noteQueued(CHAT, { queuedMessageId: 'q1', timestamp: 't1' });
    noteQueued(CHAT, { queuedMessageId: 'q2', timestamp: 't2' });
    matchQueued(CHAT, [ref('q2', 2, 'again'), ref('q1', 1, 'again')]);

    expect([at('q1'), at('q2')]).toEqual(['t1', 't2']);
  });

  it('is taken once: a second look does not give its place to the next one', () => {
    noteQueued(CHAT, { queuedMessageId: 'q1', timestamp: 't1' });
    matchQueued(CHAT, [ref('q1', 1, 'again')]);
    noteQueued(CHAT, { queuedMessageId: 'q2', timestamp: 't2' });
    matchQueued(CHAT, [ref('q1', 1, 'again'), ref('q2', 2, 'again')]);

    expect([at('q1'), at('q2')]).toEqual(['t1', 't2']);
  });

  it('only binds the acknowledged id even when another row has the same text', () => {
    noteQueued(CHAT, { queuedMessageId: 'q3', timestamp: 't1' });
    matchQueued(CHAT, [ref('q1', 1, 'see'), ref('q2', 2, 'see', ['a2'])]);

    expect([at('q1'), at('q2')]).toEqual([undefined, undefined]);
  });

  it('waits to be seen there, and is forgotten once it has left', () => {
    noteQueued(CHAT, { queuedMessageId: 'q1', timestamp: 't1' });
    matchQueued(CHAT, []);
    matchQueued(CHAT, [ref('q1', 1, 'B')]);
    expect(at('q1')).toBe('t1');

    matchQueued(CHAT, []);
    expect(at('q1')).toBeUndefined();
  });

  it('goes with its chat', () => {
    noteQueued(CHAT, { queuedMessageId: 'q1', timestamp: 't1' });
    matchQueued(CHAT, [ref('q1', 1, 'B')]);
    useHeldQueue.getState().clearChat(CHAT);

    expect(at('q1')).toBeUndefined();
  });
});
