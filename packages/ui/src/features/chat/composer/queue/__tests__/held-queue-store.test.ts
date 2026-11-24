// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { useHeldQueue } from '../held-queue-store';

function ref(overrides: Partial<QueuedMessageRef> = {}): QueuedMessageRef {
  return {
    messageId: 'm1',
    chatId: 'chat-1',
    uuid: 'u1',
    content: 'first',
    timestamp: '2026-11-24T10:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
});

describe('held queue store (C10)', () => {
  it('keeps a held message with its text and time', () => {
    useHeldQueue.getState().hold('chat-1', ref());

    expect(useHeldQueue.getState().byChat['chat-1']).toEqual([
      { messageId: 'm1', content: 'first', timestamp: '2026-11-24T10:00:01.000Z' },
    ]);
  });

  it('keeps attachment ids when the message has them', () => {
    useHeldQueue.getState().hold('chat-1', ref({ attachmentIds: ['a1', 'a2'] }));

    expect(useHeldQueue.getState().byChat['chat-1']![0]).toMatchObject({ attachmentIds: ['a1', 'a2'] });
  });

  it('orders held messages by time, whatever order they were held in', () => {
    const { hold } = useHeldQueue.getState();
    hold('chat-1', ref({ messageId: 'm2', content: 'second', timestamp: '2026-11-24T10:00:02.000Z' }));
    hold('chat-1', ref({ messageId: 'm1', content: 'first', timestamp: '2026-11-24T10:00:01.000Z' }));

    expect(useHeldQueue.getState().byChat['chat-1']!.map((row) => row.messageId)).toEqual(['m1', 'm2']);
  });

  it('holding the same message twice keeps one row', () => {
    const { hold } = useHeldQueue.getState();
    hold('chat-1', ref());
    hold('chat-1', ref({ content: 'edited elsewhere' }));

    expect(useHeldQueue.getState().byChat['chat-1']).toEqual([
      { messageId: 'm1', content: 'edited elsewhere', timestamp: '2026-11-24T10:00:01.000Z' },
    ]);
  });

  it('keeps chats apart', () => {
    const { hold } = useHeldQueue.getState();
    hold('chat-1', ref());
    hold('chat-2', ref({ messageId: 'm9', content: 'other chat' }));

    expect(Object.keys(useHeldQueue.getState().byChat).sort()).toEqual(['chat-1', 'chat-2']);
    expect(useHeldQueue.getState().byChat['chat-2']![0]!.content).toBe('other chat');
  });

  it('edits only the text of one row', () => {
    const { hold, edit } = useHeldQueue.getState();
    hold('chat-1', ref());
    hold('chat-1', ref({ messageId: 'm2', content: 'second', timestamp: '2026-11-24T10:00:02.000Z' }));

    edit('chat-1', 'm2', 'second, reworded');

    expect(useHeldQueue.getState().byChat['chat-1']!.map((row) => row.content)).toEqual(['first', 'second, reworded']);
  });

  it('removes one row and drops the chat when it was the last', () => {
    const { hold, remove } = useHeldQueue.getState();
    hold('chat-1', ref());
    hold('chat-1', ref({ messageId: 'm2', timestamp: '2026-11-24T10:00:02.000Z' }));

    remove('chat-1', 'm1');
    expect(useHeldQueue.getState().byChat['chat-1']!.map((row) => row.messageId)).toEqual(['m2']);

    remove('chat-1', 'm2');
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('persists across a reload, so a held message is not lost', () => {
    useHeldQueue.getState().hold('chat-1', ref());

    const stored = JSON.parse(localStorage.getItem('mf:held-queue')!);

    expect(stored.state.byChat['chat-1']).toEqual([
      { messageId: 'm1', content: 'first', timestamp: '2026-11-24T10:00:01.000Z' },
    ]);
  });
});

describe('held queue store — what it keeps, and for whom', () => {
  const stored = () => localStorage.getItem('mf:held-queue') ?? '';

  it('never writes down what a temporary session holds', () => {
    useHeldQueue.getState().hold('chat-temp', ref({ content: 'private words' }), { temporary: true });

    expect(useHeldQueue.getState().byChat['chat-temp']).toHaveLength(1);
    expect(stored()).not.toContain('private words');
  });

  it('keeps a temporary session’s row in memory through later changes', () => {
    const { hold } = useHeldQueue.getState();
    hold('chat-temp', ref({ content: 'private words' }), { temporary: true });
    hold('chat-1', ref({ messageId: 'm2', content: 'saved' }));

    expect(useHeldQueue.getState().byChat['chat-temp']).toHaveLength(1);
    expect(stored()).toContain('saved');
    expect(stored()).not.toContain('private words');
  });

  it('forgets a chat that ended, in storage too', () => {
    useHeldQueue.getState().hold('chat-1', ref({ content: 'gone with the chat' }));
    useHeldQueue.getState().clearChat('chat-1');

    expect(useHeldQueue.getState().byChat).toEqual({});
    expect(stored()).not.toContain('gone with the chat');
  });

  it('starts every change from what another window stored', () => {
    useHeldQueue.getState().hold('chat-1', ref());
    localStorage.setItem(
      'mf:held-queue',
      JSON.stringify({
        state: { byChat: { 'chat-2': [{ messageId: 'other', content: 'theirs', timestamp: 't' }] } },
        version: 1,
      }),
    );

    useHeldQueue.getState().hold('chat-3', ref({ messageId: 'm3', content: 'mine' }));

    expect(Object.keys(useHeldQueue.getState().byChat).sort()).toEqual(['chat-2', 'chat-3']);
  });

  it('takes nothing that another window already took', () => {
    useHeldQueue.getState().hold('chat-1', ref());
    localStorage.setItem('mf:held-queue', JSON.stringify({ state: { byChat: {} }, version: 1 }));

    expect(useHeldQueue.getState().takeFrom('chat-1', 'm1')).toEqual([]);
  });

  it('follows another window as it changes', async () => {
    localStorage.setItem(
      'mf:held-queue',
      JSON.stringify({
        state: { byChat: { 'chat-2': [{ messageId: 'x', content: 'theirs', timestamp: 't' }] } },
        version: 1,
      }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'mf:held-queue' }));

    await vi.waitFor(() => expect(useHeldQueue.getState().byChat['chat-2']).toHaveLength(1));
  });
});
