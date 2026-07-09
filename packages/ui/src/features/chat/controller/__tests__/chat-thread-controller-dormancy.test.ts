/**
 * Behavior tests for ChatThreadController dormancy split.
 *
 * Verifies:
 *   subscribeState — state-change notifications, never opens a WS sub.
 *   subscribeLive  — opens the WS sub + resume loop; ref-counted + idempotent.
 *   __LOCALID_*    — subscribeLive is a no-op (no daemon chat yet).
 *   setRemoteId    — adopts the daemon id; set-once invariant; enables live.
 *
 * Pattern mirrors chat-thread-controller-ack.test.ts: fake-ws that tracks
 * subscribe/unsubscribe call counts, REST mocked so no network traffic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false }),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
  getChat: vi.fn().mockResolvedValue(null),
}));

import { resumeChat, getChatMessages } from '../../../../lib/api/chats';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Fake WS factory — tracks subscribe/unsubscribe call counts and chatIds
// ---------------------------------------------------------------------------

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
  subscribedIds: string[];
  unsubscribedIds: string[];
}

function makeFakeWs(): FakeWs {
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;
  const subscribedIds: string[] = [];
  const unsubscribedIds: string[] = [];

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
    subscribe(chatId: string) {
      subscribedIds.push(chatId);
    },
    unsubscribe(chatId: string) {
      unsubscribedIds.push(chatId);
    },
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  function pushEvent(event: DaemonEvent): void {
    if (!capturedHandler) throw new Error('onEvent handler not yet captured');
    capturedHandler(event);
  }

  return { fakeClient, pushEvent, subscribedIds, unsubscribedIds };
}

/** Drain pending microtasks so void promise chains inside handleSubscribeAck settle. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const PORT = 9999;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. subscribeState never touches the WS
// ---------------------------------------------------------------------------

describe('dormancy — subscribeState never touches the WS', () => {
  it('does not call ws.subscribe when subscribeState is attached', () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeState(() => {});

    expect(subscribedIds).toHaveLength(0);
  });

  it('invokes the state listener when a state-changing dispatch occurs', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    const calls: number[] = [];
    ctrl.subscribeState(() => calls.push(1));

    // Trigger a state change by dispatching sendMessage — it internally dispatches
    // run.started and local.message.queued which mutate state.
    await ctrl.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      attachments: [],
      parentId: null,
    } as unknown as Parameters<typeof ctrl.sendMessage>[0]);

    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('stops invoking the state listener after off() is called', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    const calls: number[] = [];
    const off = ctrl.subscribeState(() => calls.push(1));
    off();

    await ctrl.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'after off' }],
      attachments: [],
      parentId: null,
    } as unknown as Parameters<typeof ctrl.sendMessage>[0]);

    // No calls because the listener was removed before the state change.
    expect(calls).toHaveLength(0);
  });

  it('does not call resumeChat when only subscribeState is attached', () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeState(() => {});

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. subscribeLive opens the WS once and is ref-counted + idempotent
// ---------------------------------------------------------------------------

describe('dormancy — subscribeLive opens the WS once', () => {
  it('calls ws.subscribe("chat-abc") exactly once on first subscribeLive', () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeLive();

    expect(subscribedIds).toEqual(['chat-abc']);
  });

  it('calls resumeChat via the ack path after subscribeLive + ack', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeLive();
    pushEvent({ type: 'subscribe:ack', chatId: 'chat-abc' });
    await flushMicrotasks();

    expect(resumeChat).toHaveBeenCalledOnce();
    expect(resumeChat).toHaveBeenCalledWith(PORT, 'chat-abc');
  });

  it('does NOT open a second WS sub when subscribeLive is called a second time (idempotent)', () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeLive();
    ctrl.subscribeLive();

    // Only one subscribe — the second call is a no-op ref increment.
    expect(subscribedIds).toEqual(['chat-abc']);
  });

  it('calls ws.unsubscribe("chat-abc") once when the last live ref is released', () => {
    const { fakeClient, unsubscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    const stop1 = ctrl.subscribeLive();
    const stop2 = ctrl.subscribeLive();

    // Release the first ref — should NOT unsubscribe yet.
    stop1();
    expect(unsubscribedIds).toHaveLength(0);

    // Release the last ref — NOW it must unsubscribe.
    stop2();
    expect(unsubscribedIds).toEqual(['chat-abc']);
  });

  it('stop() teardown is idempotent (calling it twice unsubscribes only once)', () => {
    const { fakeClient, unsubscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    const stop = ctrl.subscribeLive();
    stop();
    stop();

    expect(unsubscribedIds).toEqual(['chat-abc']);
  });
});

// ---------------------------------------------------------------------------
// 3. __LOCALID_* never subscribes live
// ---------------------------------------------------------------------------

describe('dormancy — __LOCALID_* never subscribes live', () => {
  it('does NOT call ws.subscribe when chatId is a __LOCALID_*', () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.subscribeLive();

    expect(subscribedIds).toHaveLength(0);
  });

  it('returns a no-op teardown for a __LOCALID_* controller', () => {
    const { fakeClient, unsubscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    const stop = ctrl.subscribeLive();
    stop();

    // unsubscribe never called because it was never subscribed.
    expect(unsubscribedIds).toHaveLength(0);
  });

  it('does NOT call resumeChat for a __LOCALID_* controller', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.subscribeLive();
    await flushMicrotasks();

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. setRemoteId enables live + redirects network ops
// ---------------------------------------------------------------------------

describe('dormancy — setRemoteId enables live and redirects network ops', () => {
  it('allows subscribeLive to call ws.subscribe with the remote id after setRemoteId', () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.setRemoteId('chat-99');
    ctrl.subscribeLive();

    expect(subscribedIds).toEqual(['chat-99']);
  });

  it('routes resumeChat to the remote id after setRemoteId + ack', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.setRemoteId('chat-99');
    ctrl.subscribeLive();
    pushEvent({ type: 'subscribe:ack', chatId: 'chat-99' });
    await flushMicrotasks();

    expect(resumeChat).toHaveBeenCalledOnce();
    expect(resumeChat).toHaveBeenCalledWith(PORT, 'chat-99');
  });

  it('routes getChatMessages to the remote id in sendMessage after setRemoteId', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.setRemoteId('chat-99');

    // sendMessage triggers load → getChatMessages; it also uses daemonId for the
    // message.send ws frame chatId.
    await ctrl.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      attachments: [],
      parentId: null,
    } as unknown as Parameters<typeof ctrl.sendMessage>[0]);

    // getChatMessages must have been called with the remote id, not the local one.
    expect(vi.mocked(getChatMessages).mock.calls.some((args) => args[1] === 'chat-99')).toBe(true);
    expect(vi.mocked(getChatMessages).mock.calls.some((args) => args[1] === '__LOCALID_a')).toBe(false);
  });

  it('throws when setRemoteId is called a second time with a different id (set-once invariant)', () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.setRemoteId('chat-99');

    expect(() => ctrl.setRemoteId('chat-other')).toThrow();
  });

  it('is a no-op when setRemoteId is called again with the same id (idempotent same-id)', () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('__LOCALID_a', PORT, fakeClient);

    ctrl.setRemoteId('chat-99');

    // Must not throw — same id is harmless.
    expect(() => ctrl.setRemoteId('chat-99')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. subscribeState works while not live — getState reflects dispatched changes
// ---------------------------------------------------------------------------

describe('dormancy — subscribeState works while not live', () => {
  it('getState() reflects dispatched changes when only subscribeState is attached', async () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeState(() => {});

    // Confirm no WS subscription happened.
    expect(subscribedIds).toHaveLength(0);

    // Send a message — this mutates state (adds a pending user message + run.started).
    await ctrl.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'state test' }],
      attachments: [],
      parentId: null,
    } as unknown as Parameters<typeof ctrl.sendMessage>[0]);

    const state = ctrl.getState();
    // runState should have advanced beyond 'idle' as a result of sendMessage.
    expect(state.runState.type).not.toBe('idle');
  });

  it('ws.subscribe is never called when only subscribeState is used (no live sub)', () => {
    const { fakeClient, subscribedIds } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeState(() => {});
    ctrl.subscribeState(() => {});

    // subscribeState must never open a WS sub regardless of how many listeners.
    expect(subscribedIds).toHaveLength(0);
  });

  it('resumeChat is never called when only subscribeState is used', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController('chat-abc', PORT, fakeClient);

    ctrl.subscribeState(() => {});
    await flushMicrotasks();
    // Advance past any potential fallback timer.
    await vi.advanceTimersByTimeAsync(3000);

    expect(resumeChat).not.toHaveBeenCalled();
  });
});
