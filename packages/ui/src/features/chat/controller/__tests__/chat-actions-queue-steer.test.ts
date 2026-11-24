// @vitest-environment jsdom
/**
 * The send side of the redesigned composer: Steer (C9) and the queue a Stop
 * holds back (C10), over a fake `ChatActionHost` — no controller, no daemon.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn().mockResolvedValue(['att-1']) }));
vi.mock('../../../../lib/api/chats', () => ({
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  unarchiveNativeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { cancelQueuedMessage } from '../../../../lib/api/chats';
import { publishCommands } from '../../commands/command-registry';
import { useHeldQueue } from '../../composer/queue/held-queue-store';
import { holdQueuedMessages, sendChatMessage, sendHeldMessages, type ChatActionHost } from '../chat-actions';
import { createChatThreadState, reduceChatThreadState, type ChatStateEvent } from '../chat-thread-state';
import { withSteer } from '../steer';

const CHAT = 'chat-1';

function ref(id: string, second: number, overrides: Partial<QueuedMessageRef> = {}): QueuedMessageRef {
  return {
    messageId: id,
    chatId: CHAT,
    uuid: `u-${id}`,
    content: `text ${id}`,
    timestamp: `2026-11-24T10:00:0${second}.000Z`,
    ...overrides,
  };
}

function makeHost(opts: { running?: boolean; queued?: QueuedMessageRef[] } = {}) {
  let state = createChatThreadState(CHAT);
  if (opts.running) state = reduceChatThreadState(state, { type: 'run.started' });
  if (opts.queued) state = reduceChatThreadState(state, { type: 'queued.snapshot', refs: opts.queued });
  const events: ChatStateEvent[] = [];
  const sendPrompt = vi.fn().mockResolvedValue({ queued: false });
  const host: ChatActionHost = {
    getPort: () => 31415,
    getDaemonId: () => CHAT,
    getState: () => state,
    dispatch: (event) => {
      events.push(event);
      state = reduceChatThreadState(state, event);
    },
    load: () => Promise.resolve(),
    sendPrompt,
  };
  return { host, events, sendPrompt };
}

function userMessage(text: string, extras: Partial<AppendMessage> = {}): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: [],
    runConfig: withSteer(undefined),
    ...extras,
  } as unknown as AppendMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  publishCommands([{ name: 'compact', description: 'Compact', source: 'claude' }]);
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
});

afterEach(() => vi.useRealTimers());

describe('sendChatMessage — Steer (C9)', () => {
  it('sends steer: true while a turn runs', async () => {
    const { host, sendPrompt } = makeHost({ running: true });

    await sendChatMessage(host, userMessage('use the other file'));

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('use the other file', { steer: true });
  });

  it('does not steer while idle: the message is an ordinary prompt', async () => {
    const { host, sendPrompt } = makeHost({ running: false });

    await sendChatMessage(host, userMessage('hello'));

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('hello', {});
  });

  it('does not steer a message that did not ask to', async () => {
    const { host, sendPrompt } = makeHost({ running: true });

    await sendChatMessage(host, userMessage('later', { runConfig: undefined }));

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('later', {});
  });

  it('does not steer a slash command', async () => {
    const { host, sendPrompt } = makeHost({ running: true });

    await sendChatMessage(host, userMessage('/compact'));

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('/compact', {
      command: { name: 'compact', source: 'claude' },
    });
  });

  it('does not steer a message with attachments, which are uploaded and sent as a queued prompt', async () => {
    const { host, sendPrompt } = makeHost({ running: true });
    const attachments = [
      {
        id: 'a',
        type: 'image',
        name: 'shot.png',
        contentType: 'image/png',
        content: [{ type: 'image', image: 'data:image/png;base64,aGVsbG8=' }],
        status: { type: 'complete' },
      },
    ];

    await sendChatMessage(host, userMessage('see this', { attachments } as Partial<AppendMessage>));

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('see this', { attachmentIds: ['att-1'] });
  });

  it('keeps a steered send as a visible pending, flagged steered, not a hidden queue row', async () => {
    const { host, events } = makeHost({ running: true });

    await sendChatMessage(host, userMessage('now'));

    const queuedEvent = events.find((e) => e.type === 'local.message.queued');
    expect(queuedEvent).toMatchObject({ pending: { text: 'now', sendMeta: { steer: true } } });
    expect(queuedEvent).not.toMatchObject({ pending: { queueing: true } });
  });

  it('marks a plain send behind a running turn as queueing', async () => {
    const { host, events } = makeHost({ running: true });

    await sendChatMessage(host, userMessage('later', { runConfig: undefined }));

    expect(events.find((e) => e.type === 'local.message.queued')).toMatchObject({
      pending: { text: 'later', queueing: true },
    });
  });

  it('does not mark a send while idle as queueing', async () => {
    const { host, events } = makeHost({ running: false });

    await sendChatMessage(host, userMessage('hello', { runConfig: undefined }));

    expect(events.find((e) => e.type === 'local.message.queued')).not.toMatchObject({ pending: { queueing: true } });
  });
});

describe('holdQueuedMessages (C10)', () => {
  it('takes every queued message back from the daemon and keeps it held, in order', async () => {
    const { host } = makeHost({ running: true, queued: [ref('m2', 2), ref('m1', 1)] });

    await holdQueuedMessages(host);

    expect(vi.mocked(cancelQueuedMessage).mock.calls.map((c) => c.slice(0, 3))).toEqual([
      [31415, CHAT, 'm2'],
      [31415, CHAT, 'm1'],
    ]);
    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m1', 'm2']);
  });

  it('does nothing with an empty queue', async () => {
    const { host } = makeHost({ running: true });

    await holdQueuedMessages(host);

    expect(cancelQueuedMessage).not.toHaveBeenCalled();
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('leaves a message the agent already picked up (it has a delivery state)', async () => {
    const { host } = makeHost({ running: true, queued: [ref('m1', 1, { delivery: 'unconfirmed' }), ref('m2', 2)] });

    await holdQueuedMessages(host);

    expect(vi.mocked(cancelQueuedMessage).mock.calls.map((c) => c[2])).toEqual(['m2']);
    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m2']);
  });

  it('does not hold a message whose cancel failed, and still holds the others', async () => {
    vi.mocked(cancelQueuedMessage).mockImplementation(async (_port, _chat, id) => {
      if (id === 'm1') throw new Error('gone');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = makeHost({ running: true, queued: [ref('m1', 1), ref('m2', 2)] });

    await holdQueuedMessages(host);

    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m2']);
    warn.mockRestore();
    vi.mocked(cancelQueuedMessage).mockResolvedValue(undefined);
  });

  it('stops waiting after one second so Stop is never held up by a slow daemon', async () => {
    vi.useFakeTimers();
    vi.mocked(cancelQueuedMessage).mockImplementation(() => new Promise(() => {}));
    const { host } = makeHost({ running: true, queued: [ref('m1', 1)] });
    let settled = false;

    void holdQueuedMessages(host).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(settled).toBe(true);
    vi.mocked(cancelQueuedMessage).mockResolvedValue(undefined);
  });
});

describe('sendHeldMessages (C10)', () => {
  const hold = (id: string, second: number, content = `text ${id}`) =>
    useHeldQueue.getState().hold(CHAT, ref(id, second, { content }));

  it('sends the chosen row, then every row behind it in order, removing each as it goes', async () => {
    hold('m1', 1);
    hold('m2', 2);
    hold('m3', 3);
    const { host, sendPrompt } = makeHost();

    await sendHeldMessages(host, 'm1');

    expect(sendPrompt.mock.calls).toEqual([
      ['text m1', {}],
      ['text m2', {}],
      ['text m3', {}],
    ]);
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('sending a later row leaves the rows before it held', async () => {
    hold('m1', 1);
    hold('m2', 2);
    hold('m3', 3);
    const { host, sendPrompt } = makeHost();

    await sendHeldMessages(host, 'm2');

    expect(sendPrompt.mock.calls.map((c) => c[0])).toEqual(['text m2', 'text m3']);
    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m1']);
  });

  it('carries a row’s attachment ids', async () => {
    useHeldQueue.getState().hold(CHAT, ref('m1', 1, { attachmentIds: ['a1'] }));
    const { host, sendPrompt } = makeHost();

    await sendHeldMessages(host, 'm1');

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('text m1', { attachmentIds: ['a1'] });
  });

  it('stops at a failed send and keeps that row and the ones behind it', async () => {
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();
    sendPrompt.mockResolvedValueOnce({ queued: false }).mockRejectedValueOnce(new Error('offline'));

    await expect(sendHeldMessages(host, 'm1')).rejects.toThrow('offline');

    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m2']);
  });

  it('does nothing for an unknown row', async () => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();

    await sendHeldMessages(host, 'nope');

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useHeldQueue.getState().byChat[CHAT]).toHaveLength(1);
  });
});
