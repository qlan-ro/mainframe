// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { heldTimestamp, noteQueued } from '../sent-order';
import { useHeldQueue } from '../held-queue-store';

it('clears project and legacy rows from fresh storage and forgets sent-only chats', () => {
  const row = { messageId: 'm1', content: 'text', timestamp: 't' };
  localStorage.setItem(
    'mf:held-queue',
    JSON.stringify({
      version: 1,
      state: {
        byChat: {
          tagged: [{ ...row, daemon: 'local', projectId: 'p' }],
          legacy: [row],
          unknown: [row],
          elsewhere: [{ ...row, daemon: 'other', projectId: 'p' }],
          unrelated: [{ ...row, daemon: 'local', projectId: 'other' }],
        },
      },
    }),
  );
  noteQueued('sent-only', { queuedMessageId: 'q', timestamp: 't' });

  noteQueued('tagged', { queuedMessageId: 'q', timestamp: 't' });

  useHeldQueue.getState().clearProject('p', ['legacy', 'sent-only', 'unrelated']);

  expect(Object.keys(useHeldQueue.getState().byChat)).toEqual(['unknown', 'elsewhere', 'unrelated']);
  expect(heldTimestamp('tagged', 'q')).toBeUndefined();
  expect(heldTimestamp('sent-only', 'q')).toBeUndefined();
});
