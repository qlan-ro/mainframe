/**
 * Behavior test for the first-message handoff gap.
 *
 * A brand-new chat starts as a __LOCALID_* draft with NO live WS subscription
 * (the sub is gated on the chat having a remote id). On first send the daemon
 * appends the user message and emits `display.messages.set [user]` BEFORE the
 * subscription attaches — so that event is lost, the optimistic pending is never
 * reconciled, and `projectChatThreadMessages` renders the lingering pending last
 * (the first message appears at the bottom of the transcript).
 *
 * The fix: the INITIAL subscribe:ack must refresh history (not only the reconnect
 * ack). The forced reload re-seeds the transcript from REST — which by then holds
 * the user message — and `reconcilePendingAgainstHistory` clears the pending.
 *
 * Setup mirrors chat-thread-controller-ack.test.ts (fake DaemonWsClient with a
 * captured onEvent handler; lib/api/chats mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { DaemonEvent, DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false }),
  getChat: vi.fn().mockResolvedValue({ id: 'chat', adapterId: 'claude' }),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { getChatMessages } from '../../../../lib/api/chats';
import { ChatThreadController } from '../chat-thread-controller';

/** Drain pending microtasks (async chains inside handleSubscribeAck / load). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fake WS client with captured onEvent handler
// ---------------------------------------------------------------------------

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
}

function makeFakeWs(): FakeWs {
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;

  const fakeClient: DaemonWsClient = {
    get connected() {
      return true;
    },
    send: () => {},
    onEvent(handler: (event: DaemonEvent) => void) {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    },
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  function pushEvent(event: DaemonEvent): void {
    if (!capturedHandler) throw new Error('onEvent handler not yet captured');
    capturedHandler(event);
  }

  return { fakeClient, pushEvent };
}

const CHAT_ID = 'chat-handoff';
const PORT = 9999;

function textAppendMsg(text: string): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: [],
    parentId: null,
  } as unknown as AppendMessage;
}

function userDisplayMsg(id: string, text: string): DisplayMessage {
  return {
    id,
    chatId: CHAT_ID,
    type: 'user',
    content: [{ type: 'text', text }],
    timestamp: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reactivation after dormancy — re-seeds on the reattach ack', () => {
  it('refreshes history when a warm controller re-attaches, even with no pending send', async () => {
    // First activation: the chat already holds one message; the mount load() seeds it.
    vi.mocked(getChatMessages).mockResolvedValue({
      messages: [userDisplayMsg('srv-1', 'first')],
      transcriptMissing: false,
    });

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    const stop = ctrl.subscribeLive();
    await ctrl.load();
    await flushMicrotasks();

    // Initial attach ack: no reconnect, no pending → the first attach must NOT
    // force a reseed (the streaming-clobber optimization is preserved).
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();
    expect(ctrl.getState().messageOrder).toEqual(['srv-1']);

    // Switch away — the live sub is torn down (dormancy).
    stop();

    // While dormant, the daemon appended a message. It is persisted (REST now
    // returns it) but was never delivered live — the controller had no sub.
    vi.mocked(getChatMessages).mockResolvedValue({
      messages: [userDisplayMsg('srv-1', 'first'), userDisplayMsg('srv-2', 'arrived while backgrounded')],
      transcriptMissing: false,
    });

    // Switch back — a fresh sub attaches. The user was only reading, so there is
    // NO unreconciled pending; only the reattach signal can trigger the catch-up.
    ctrl.subscribeLive();
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    // The reattach ack must re-seed history so the missed message appears.
    expect(ctrl.getState().messageOrder).toEqual(['srv-1', 'srv-2']);
  });
});

describe('initial subscribe:ack — recovers a missed handoff event', () => {
  it('refreshes history on the first ack so the optimistic pending is reconciled', async () => {
    // The just-created chat is empty when the first load + send happen.
    vi.mocked(getChatMessages).mockResolvedValue({ messages: [], transcriptMissing: false });

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // First send: adds the optimistic pending. The daemon's `display.messages.set
    // [user]` is NOT delivered here (simulating the handoff gap — the sub's events
    // are not pushed), so the pending is not reconciled by the live path.
    await ctrl.sendMessage(textAppendMsg('which model are you?'));
    await flushMicrotasks();

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);

    // The daemon now holds the user message; a refresh would reconcile the pending.
    vi.mocked(getChatMessages).mockResolvedValue({
      messages: [userDisplayMsg('srv-1', 'which model are you?')],
      transcriptMissing: false,
    });

    // The subscription finally attaches and acks (initial, not a reconnect).
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    // The initial ack must have refreshed history, reconciling the lingering pending.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});
