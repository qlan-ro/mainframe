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
  cancelQueuedMessage: vi.fn().mockResolvedValue(true),
  unarchiveNativeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { cancelQueuedMessage } from '../../../../lib/api/chats';
import { publishCommands } from '../../commands/command-registry';
import { NotSentError } from '../../../../lib/daemon/not-sent-error';
import { CLAIM_MS, useHeldQueue } from '../../composer/queue/held-queue-store';
import { forgetSent } from '../../composer/queue/sent-order';
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

function makeHost(opts: { running?: boolean; queued?: QueuedMessageRef[]; temporary?: boolean } = {}) {
  let state = createChatThreadState(CHAT);
  if (opts.temporary !== undefined) {
    state = { ...state, chatConfig: { temporary: opts.temporary } as NonNullable<typeof state.chatConfig> };
  }
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
    announceUserSend: vi.fn(),
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
  forgetSent(CHAT);
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

  it('does not hold a message the agent had already picked up', async () => {
    vi.mocked(cancelQueuedMessage).mockImplementation(async (_port, _chat, id) => id !== 'm1');
    const { host } = makeHost({ running: true, queued: [ref('m1', 1), ref('m2', 2)] });

    await holdQueuedMessages(host);

    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m2']);
    vi.mocked(cancelQueuedMessage).mockResolvedValue(true);
  });

  it('does not hold a message whose cancel failed, and still holds the others', async () => {
    vi.mocked(cancelQueuedMessage).mockImplementation(async (_port, _chat, id) => {
      if (id === 'm1') throw new Error('gone');
      return true;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = makeHost({ running: true, queued: [ref('m1', 1), ref('m2', 2)] });

    await holdQueuedMessages(host);

    expect(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId)).toEqual(['m2']);
    warn.mockRestore();
    vi.mocked(cancelQueuedMessage).mockResolvedValue(true);
  });

  it('holds a temporary session’s messages in memory only', async () => {
    const { host } = makeHost({ running: true, queued: [ref('m1', 1)], temporary: true });

    await holdQueuedMessages(host);

    expect(useHeldQueue.getState().byChat[CHAT]).toHaveLength(1);
    expect(localStorage.getItem('mf:held-queue') ?? '').not.toContain('text m1');
  });

  it('writes down what any other session holds', async () => {
    const { host } = makeHost({ running: true, queued: [ref('m1', 1)], temporary: false });

    await holdQueuedMessages(host);

    expect(localStorage.getItem('mf:held-queue')).toContain('text m1');
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
    vi.mocked(cancelQueuedMessage).mockResolvedValue(true);
  });
});

describe('sendHeldMessages (C10)', () => {
  const hold = (id: string, second: number, content = `text ${id}`) =>
    useHeldQueue.getState().hold(CHAT, ref(id, second, { content }));

  it('sends each row once however often Send now is pressed', async () => {
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();

    await Promise.all([sendHeldMessages(host, 'm1'), sendHeldMessages(host, 'm1')]);

    expect(sendPrompt.mock.calls.map((call) => call[0])).toEqual(['text m1', 'text m2']);
  });

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

    // The failed one may have reached the agent; neither is claimed any more.
    expect(useHeldQueue.getState().byChat[CHAT]).toEqual([
      { messageId: 'm2', content: 'text m2', timestamp: ref('m2', 2).timestamp, daemon: 'local', unconfirmed: true },
    ]);
  });

  it('keeps each row until the daemon has it', async () => {
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();
    const heldDuring: string[][] = [];
    sendPrompt.mockImplementation(async () => {
      heldDuring.push(useHeldQueue.getState().byChat[CHAT]!.map((row) => row.messageId));
      return { queued: false };
    });

    await sendHeldMessages(host, 'm1');

    expect(heldDuring).toEqual([['m1', 'm2'], ['m2']]);
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('sends nothing more once the chat is gone', async () => {
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();
    sendPrompt.mockImplementation(async () => {
      useHeldQueue.getState().clearChat(CHAT);
      return { queued: false };
    });

    await sendHeldMessages(host, 'm1');

    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  /** A prompt that stays out until told. */
  function heldUp(sendPrompt: ReturnType<typeof makeHost>['sendPrompt']) {
    let answer = { accept: () => {}, refuse: (_error: unknown) => {} };
    sendPrompt.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          answer = { accept: () => resolve({ queued: false }), refuse: reject };
        }),
    );
    return { accept: () => answer.accept(), refuse: (error: unknown) => answer.refuse(error) };
  }
  const row = (id: string) => useHeldQueue.getState().byChat[CHAT]!.find((held) => held.messageId === id)!;

  it('a Stop meanwhile cancels the rows that have not gone out, and lets the one that has finish', async () => {
    hold('m1', 1);
    hold('m2', 2);
    hold('m3', 3);
    const { host, sendPrompt } = makeHost();
    const first = heldUp(sendPrompt);
    const sending = sendHeldMessages(host, 'm1');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));

    await holdQueuedMessages(host);
    first.accept();
    await sending;

    expect(sendPrompt.mock.calls.map((call) => call[0])).toEqual(['text m1']);
    expect(useHeldQueue.getState().byChat[CHAT]!.map((held) => [held.messageId, held.claim, held.unconfirmed])).toEqual(
      [
        ['m2', undefined, undefined],
        ['m3', undefined, undefined],
      ],
    );
  });

  it('what a Stop cancelled can be sent again', async () => {
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();
    const first = heldUp(sendPrompt);
    const sending = sendHeldMessages(host, 'm1');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
    await holdQueuedMessages(host);
    first.accept();
    await sending;

    await sendHeldMessages(host, 'm2');

    expect(sendPrompt.mock.calls.map((call) => call[0])).toEqual(['text m1', 'text m2']);
  });

  /** A session whose load waits until told. */
  function loadLater(host: ChatActionHost) {
    const waiting: (() => void)[] = [];
    host.load = () => new Promise((resolve) => void waiting.push(resolve));
    return () => waiting.forEach((resolve) => resolve());
  }

  it('Send now, Stop, Send now while the session loads sends each row once', async () => {
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();
    const loaded = loadLater(host);
    const first = sendHeldMessages(host, 'm1');
    await holdQueuedMessages(host);
    const second = sendHeldMessages(host, 'm1');

    loaded();
    await Promise.all([first, second]);

    expect(sendPrompt.mock.calls.map((call) => call[0])).toEqual(['text m1', 'text m2']);
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('so does a second Send now after the first one’s claim ran out', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-24T10:00:00.000Z'), toFake: ['Date'] });
    hold('m1', 1);
    hold('m2', 2);
    const { host, sendPrompt } = makeHost();
    const loaded = loadLater(host);
    const first = sendHeldMessages(host, 'm1');
    vi.setSystemTime(Date.now() + CLAIM_MS);
    const second = sendHeldMessages(host, 'm1');

    loaded();
    await Promise.all([first, second]);

    expect(sendPrompt.mock.calls.map((call) => call[0])).toEqual(['text m1', 'text m2']);
  });

  it('a press that was stopped sends nothing when its session loads', async () => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();
    const loaded = loadLater(host);
    const sending = sendHeldMessages(host, 'm1');
    await holdQueuedMessages(host);

    loaded();
    await sending;

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(row('m1')).not.toHaveProperty('unconfirmed');
  });

  describe('the order, through a send and a Stop', () => {
    /** The daemon: what it queues gets a new id and a new time. */
    function queueingDaemon() {
      const made = makeHost({ running: true });
      const queue: QueuedMessageRef[] = [];
      const enqueue = (content: string, attachmentIds?: string[]) => {
        queue.push(
          ref(`q${queue.length + 1}`, 0, {
            content,
            attachmentIds,
            timestamp: `2026-11-24T11:00:0${queue.length}.000Z`,
          }),
        );
        made.host.dispatch({ type: 'queued.snapshot', refs: queue });
        return queue[queue.length - 1]!.messageId;
      };
      made.sendPrompt.mockImplementation(async (content: string, meta: { attachmentIds?: string[] }) => {
        return { queued: true, queuedMessageId: enqueue(content, meta.attachmentIds) };
      });
      return { ...made, enqueue };
    }
    const heldTexts = () => useHeldQueue.getState().byChat[CHAT]!.map((held) => held.content);

    it('a row the agent queued comes back before the ones that never went out', async () => {
      hold('a', 1, 'A');
      hold('b', 2, 'B');
      hold('c', 3, 'C');
      const { host, sendPrompt, enqueue } = queueingDaemon();
      sendPrompt
        .mockResolvedValueOnce({ queued: false })
        .mockImplementationOnce(async () => {
          enqueue('B');
          return { queued: true, queuedMessageId: 'q1' };
        })
        .mockRejectedValueOnce(new NotSentError('connection closed'));

      await sendHeldMessages(host, 'a').catch(() => {});
      await holdQueuedMessages(host);

      expect(heldTexts()).toEqual(['B', 'C']);
    });

    it('and before one typed meanwhile, which goes last', async () => {
      hold('b', 2, 'B');
      hold('c', 3, 'C');
      const { host, sendPrompt, enqueue } = queueingDaemon();
      sendPrompt
        .mockImplementationOnce(async () => {
          enqueue('B');
          enqueue('D');
          return { queued: true, queuedMessageId: 'q1' };
        })
        .mockRejectedValueOnce(new NotSentError('connection closed'));

      await sendHeldMessages(host, 'b').catch(() => {});
      await holdQueuedMessages(host);

      expect(heldTexts()).toEqual(['B', 'C', 'D']);
    });

    it('so does one whose place in the queue shows only after the answer', async () => {
      hold('b', 2, 'B');
      hold('c', 3, 'C');
      const { host, sendPrompt, enqueue } = queueingDaemon();
      sendPrompt
        .mockResolvedValueOnce({ queued: true, queuedMessageId: 'q1' })
        .mockRejectedValueOnce(new NotSentError('connection closed'));

      await sendHeldMessages(host, 'b').catch(() => {});
      enqueue('B');
      await holdQueuedMessages(host);

      expect(heldTexts()).toEqual(['B', 'C']);
    });

    it('stays through several sends and stops', async () => {
      hold('a', 1, 'A');
      hold('b', 2, 'B');
      hold('c', 3, 'C');
      for (let round = 0; round < 2; round++) {
        const { host } = queueingDaemon();
        await sendHeldMessages(host, useHeldQueue.getState().byChat[CHAT]![0]!.messageId);
        await holdQueuedMessages(host);
        expect(heldTexts()).toEqual(['A', 'B', 'C']);
      }
    });

    it('keeps its place when the echoed text contains attachment markup', async () => {
      useHeldQueue.getState().hold(CHAT, ref('b', 2, { content: 'see', attachmentIds: ['a1'] }));
      hold('c', 3, 'C');
      const { host, sendPrompt, enqueue } = queueingDaemon();
      sendPrompt
        .mockImplementationOnce(async () => {
          enqueue('see\n[a1]', ['a1']);
          return { queued: true, queuedMessageId: 'q1' };
        })
        .mockRejectedValueOnce(new NotSentError('connection closed'));

      await sendHeldMessages(host, 'b').catch(() => {});
      await holdQueuedMessages(host);

      expect(heldTexts()).toEqual(['see\n[a1]', 'C']);
    });

    it('a message with the same text, typed once the first was taken, is not taken for it', async () => {
      hold('b', 2, 'again');
      hold('c', 3, 'C');
      const { host, sendPrompt } = queueingDaemon();
      sendPrompt
        .mockImplementationOnce(async () => {
          host.dispatch({ type: 'queued.snapshot', refs: [ref('q1', 1, { content: 'again' })] });
          return { queued: true, queuedMessageId: 'q1' };
        })
        .mockRejectedValueOnce(new NotSentError('connection closed'));
      await sendHeldMessages(host, 'b').catch(() => {});
      // Queued, then taken by the agent; its twin is typed later.
      const twin = ref('q2', 0, { content: 'again', timestamp: '2026-11-24T11:00:00.000Z' });
      host.dispatch({ type: 'queued.snapshot', refs: [twin] });

      await holdQueuedMessages(host);

      expect(heldTexts()).toEqual(['C', 'again']);
    });
  });

  it('a Stop leaves another window’s claims alone', async () => {
    localStorage.setItem(
      'mf:held-queue',
      JSON.stringify({
        state: {
          byChat: {
            [CHAT]: [
              {
                messageId: 'm1',
                content: 'x',
                timestamp: 't',
                claim: { by: 'another', press: 'theirs', at: Date.now() },
              },
            ],
          },
        },
        version: 1,
      }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'mf:held-queue' }));
    await vi.waitFor(() => expect(row('m1').claim).toBeDefined());
    const { host } = makeHost();

    await holdQueuedMessages(host);

    expect(row('m1').claim).toBeDefined();
  });

  it('waits for the session to load: until then nothing has gone out', async () => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();
    host.load = () => Promise.reject(new Error('daemon gone'));

    await expect(sendHeldMessages(host, 'm1')).rejects.toThrow('daemon gone');

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(row('m1')).not.toHaveProperty('unconfirmed');
    expect(row('m1')).not.toHaveProperty('claim');
  });

  const refusal = (extra: object) => ({
    code: -32002,
    message: 'session unavailable: Chat chat-1 not running',
    data: { '_mainframe.dev': { reason: 'Chat chat-1 not running', ...extra } },
  });

  const refusedWith = (reason: string, extra: object = {}) => ({
    ...refusal({ neverDelivered: true, ...extra }),
    data: { '_mainframe.dev': { reason, neverDelivered: true, ...extra } },
  });

  it.each([
    ['a session that is not running', refusedWith('Chat chat-1 not running'), 'the session is not running.'],
    ['a process that is gone', refusedWith('Session s9 not spawned'), 'the session is not running.'],
    ['a full queue', refusedWith('Session s9 stdin queue is full'), 'the agent has too many messages waiting.'],
    [
      'a missing folder',
      refusedWith('Project directory does not exist or is not accessible: /tmp/x'),
      'the session’s folder is unavailable.',
    ],
    ['an unexplained send failure', refusedWith('-32600: thread_4f2 not found'), 'the message could not be sent.'],
    [
      'a message too large for the handoff',
      refusedWith('This message is too large to send with Codex’s context handoff. Shorten it.'),
      'This message is too large to send with Codex’s context handoff. Shorten it.',
    ],
    [
      'an archived provider session',
      refusedWith('Codex archived this thread. Unarchive it to continue.', { remedy: 'unarchive_native_session' }),
      'Codex archived this thread. Unarchive it to continue.',
    ],
    [
      'a daemon that could not read it',
      { code: -32602, message: 'invalid params: prompt' },
      'the daemon could not read it.',
    ],
    ['a closed connection', new NotSentError('connection closed'), 'the connection to the daemon was lost.'],
  ])(
    'a row refused by %s says so in plain words, logs the rest, and is not said to have arrived',
    async (_what, error, reason) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hold('m1', 1);
      const { host, sendPrompt } = makeHost();
      sendPrompt.mockRejectedValueOnce(error);

      await expect(sendHeldMessages(host, 'm1')).rejects.toBe(error);

      expect(row('m1')).toEqual(expect.objectContaining({ refused: reason }));
      expect(row('m1')).not.toHaveProperty('unconfirmed');
      expect(row('m1')).not.toHaveProperty('claim');
      const raw = 'data' in error ? error.data['_mainframe.dev'].reason : error.message;
      expect(warn).toHaveBeenCalledWith('[chat] held message refused', { chatId: CHAT, messageId: 'm1', raw });
      warn.mockRestore();
    },
  );

  it.each([
    ['timed out', { code: -32000, message: 'request timed out' }],
    ['lost its connection', { code: -32000, message: 'connection closed' }],
    ['a daemon that does not say', refusal({})],
  ])('a row whose prompt %s may have reached the agent', async (_what, error) => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();
    sendPrompt.mockRejectedValueOnce(error);

    await expect(sendHeldMessages(host, 'm1')).rejects.toBe(error);

    expect(row('m1')).toMatchObject({ unconfirmed: true });
    expect(row('m1')).not.toHaveProperty('refused');
  });

  it('a refusal does not take back that an earlier send may have reached the agent', async () => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();
    sendPrompt.mockRejectedValueOnce({ code: -32000, message: 'request timed out' });
    await sendHeldMessages(host, 'm1').catch(() => {});
    sendPrompt.mockRejectedValueOnce(refusal({ neverDelivered: true }));
    await sendHeldMessages(host, 'm1').catch(() => {});

    expect(row('m1')).toMatchObject({ unconfirmed: true });
  });

  it('sending it again forgets the refusal', async () => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();
    sendPrompt.mockRejectedValueOnce(refusal({ neverDelivered: true }));
    await sendHeldMessages(host, 'm1').catch(() => {});
    sendPrompt.mockRejectedValueOnce({ code: -32000, message: 'request timed out' });
    await sendHeldMessages(host, 'm1').catch(() => {});

    expect(row('m1')).toMatchObject({ unconfirmed: true });
    expect(row('m1')).not.toHaveProperty('refused');
  });

  it('does nothing for an unknown row', async () => {
    hold('m1', 1);
    const { host, sendPrompt } = makeHost();

    await sendHeldMessages(host, 'nope');

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useHeldQueue.getState().byChat[CHAT]).toHaveLength(1);
  });
});
