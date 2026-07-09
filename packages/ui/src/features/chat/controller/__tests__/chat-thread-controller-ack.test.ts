/**
 * Behavior tests for subscribe:ack gating (fix #3).
 *
 * The controller must NOT call resumeChat until either:
 *   (a) a {type:'subscribe:ack', chatId} event arrives through onEvent, OR
 *   (b) the fallback timer (~2000ms) fires.
 * After one of those paths fires, a late ack must NOT trigger a second call.
 *
 * Strategy
 * --------
 * - vi.useFakeTimers() controls setTimeout so we advance time explicitly.
 * - The fake WS client captures the onEvent handler so we can push a synthetic
 *   ack event.
 * - resumeChat is vi.mock'd — we count how many times it was called.
 * - the WS subscription is opened by calling ctrl.subscribeLive().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
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
}));

import { resumeChat } from '../../../../lib/api/chats';
import { ChatThreadController } from '../chat-thread-controller';

/** Drain pending microtasks (Promise.resolve chain). */
async function flushMicrotasks(): Promise<void> {
  // Three awaits cover the void promise chain inside handleSubscribeAck:
  //   handleSubscribeAck calls resumeChat().catch() — two microtask ticks.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fake WS client with captured onEvent handler
// ---------------------------------------------------------------------------

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
}

function makeFakeWs(connected = true): FakeWs {
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;

  const fakeClient: DaemonWsClient = {
    get connected() {
      return connected;
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

const CHAT_ID = 'chat-ack';
const PORT = 9999;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// (a) resumeChat is NOT called before ack, then called ONCE when ack arrives
// ---------------------------------------------------------------------------

describe('subscribe:ack gating', () => {
  it('does not call resumeChat before the ack is delivered', () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive(); // triggers ensureWsSubscription

    // No ack yet — resumeChat must not have been called.
    expect(resumeChat).not.toHaveBeenCalled();
  });

  it('calls resumeChat exactly once when a matching subscribe:ack arrives', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });

    // Drain microtasks so the void promise chain inside handleSubscribeAck settles.
    await flushMicrotasks();

    expect(resumeChat).toHaveBeenCalledOnce();
    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('does NOT call resumeChat when the ack chatId does not match', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'subscribe:ack', chatId: 'chat-other' });
    await flushMicrotasks();

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (b) Fallback timer fires after ~2000ms and calls resumeChat once
// ---------------------------------------------------------------------------

describe('subscribe:ack fallback timer', () => {
  it('calls resumeChat once when no ack arrives within the timeout', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Advance past the 2000ms fallback.
    await vi.advanceTimersByTimeAsync(2001);

    expect(resumeChat).toHaveBeenCalledOnce();
    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('does not call resumeChat before the full timeout has elapsed', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    await vi.advanceTimersByTimeAsync(1999);

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (c) A late ack after the fallback already fired must NOT call resumeChat again
// ---------------------------------------------------------------------------

describe('subscribe:ack — late ack after fallback', () => {
  it('does not call resumeChat a second time when a late ack arrives after the fallback', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Let the fallback fire first.
    await vi.advanceTimersByTimeAsync(2001);
    expect(resumeChat).toHaveBeenCalledOnce();

    // Now deliver the ack late.
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    // Still only one call — the awaitingAck guard prevents the second.
    expect(resumeChat).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// (d) Fallback timer does NOT resume when the socket is disconnected (fix #3)
// ---------------------------------------------------------------------------

describe('subscribe:ack fallback timer — disconnected socket', () => {
  it('does not call resumeChat when the socket is disconnected at fallback time', async () => {
    // Build the controller with a disconnected WS client.
    const { fakeClient } = makeFakeWs(false);
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Advance past the 2000ms fallback — the timer fires but ws.connected is false.
    await vi.advanceTimersByTimeAsync(2001);

    // The guard inside the fallback timer must prevent resumeChat from being called.
    expect(resumeChat).not.toHaveBeenCalled();
  });
});
