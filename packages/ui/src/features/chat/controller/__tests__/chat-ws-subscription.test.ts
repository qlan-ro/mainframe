/**
 * Behavior tests for ChatWsSubscription.
 *
 * Covers:
 *   - attach() wires the onEvent handler, calls ws.subscribe once, arms a
 *     connection listener.
 *   - subscribe:ack for the matching chatId triggers resumeChat once and reads
 *     getPendingPermission once; a mismatched chatId is ignored.
 *   - Ack-fallback: no ack + ws.connected===true → resumeChat after 2000ms;
 *     ws.connected===false → does NOT resume.
 *   - Reconnect: connection-listener fires while connected → re-sends subscribe,
 *     and after the ack calls onSubscribeRefresh() once.
 *   - restorePendingPermission: toolUseId in getRecentlyReplied() → dispatchPermission
 *     NOT called; otherwise called once.
 *   - detach() calls ws.unsubscribe, tears down both unsub handles, clears the
 *     ack-fallback timer (a later timer fire is a no-op).
 *
 * Strategy
 * --------
 * - vi.useFakeTimers() controls setTimeout / clearTimeout.
 * - FakeWs captures the onEvent handler and the connection listener so tests
 *   can push synthetic events or fire reconnects.
 * - resumeChat and getPendingPermission are vi.mock'd — call counts are asserted.
 * - detach() is called in afterEach to silence any outstanding timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent, ControlRequest } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/chats', () => ({
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  // stubs for imports other modules in the same tree pull in
  getChatMessages: vi.fn().mockResolvedValue([]),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { resumeChat, getPendingPermission } from '../../../../lib/api/chats';
import { ChatWsSubscription } from '../chat-ws-subscription';
import type { ChatWsHost } from '../chat-ws-subscription';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain the microtask queue enough to settle async chains. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fake WS client
// ---------------------------------------------------------------------------

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
  fireConnectionListener: () => void;
  subscribeCalls: string[];
  unsubscribeCalls: string[];
}

function makeFakeWs(initiallyConnected = true): FakeWs {
  let eventHandler: ((event: DaemonEvent) => void) | null = null;
  let connListener: (() => void) | null = null;
  let isConnected = initiallyConnected;

  const subscribeCalls: string[] = [];
  const unsubscribeCalls: string[] = [];

  const fakeClient: DaemonWsClient = {
    get connected() {
      return isConnected;
    },
    send: () => {},
    onEvent(handler: (event: DaemonEvent) => void) {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    },
    subscribe(chatId: string) {
      subscribeCalls.push(chatId);
    },
    unsubscribe(chatId: string) {
      unsubscribeCalls.push(chatId);
    },
    subscribeConnection(listener: () => void) {
      connListener = listener;
      return () => {
        connListener = null;
      };
    },
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  function pushEvent(event: DaemonEvent): void {
    // After detach the handler is torn down (its unsub nulls it); a real WS would
    // simply not forward — mirror that no-op rather than throwing, so the
    // "stops forwarding events after detach" assertion can run.
    if (!eventHandler) return;
    eventHandler(event);
  }

  function fireConnectionListener(): void {
    if (!connListener) throw new Error('connection listener not yet registered');
    connListener();
  }

  // Expose a way to flip connected state for reconnect tests.
  Object.defineProperty(fakeClient, '_setConnected', {
    value: (v: boolean) => {
      isConnected = v;
    },
  });

  return { fakeClient, pushEvent, fireConnectionListener, subscribeCalls, unsubscribeCalls };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-abc';
const PORT = 9999;

/** Build a minimal ChatWsHost with overridable stubs. */
function makeHost(
  fakeWs: FakeWs,
  overrides: Partial<ChatWsHost> = {},
): {
  host: ChatWsHost;
  onEventSpy: ReturnType<typeof vi.fn>;
  dispatchSpy: ReturnType<typeof vi.fn>;
  subscribeRefreshSpy: ReturnType<typeof vi.fn>;
} {
  const onEventSpy = vi.fn();
  const dispatchSpy = vi.fn();
  const subscribeRefreshSpy = vi.fn();
  const host: ChatWsHost = {
    chatId: CHAT_ID,
    port: PORT,
    ws: fakeWs.fakeClient,
    onEvent: onEventSpy,
    getRecentlyReplied: () => new Set<string>(),
    getHeldPermissionIds: () => new Set<string>(),
    dispatchPermission: dispatchSpy,
    onSubscribeRefresh: subscribeRefreshSpy,
    hasUnreconciledPendings: () => false,
    isDisposed: () => false,
    ...overrides,
  };
  return { host, onEventSpy, dispatchSpy, subscribeRefreshSpy };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let activeSub: ChatWsSubscription | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  activeSub = null;
});

afterEach(() => {
  activeSub?.detach();
  activeSub = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. attach() wires onEvent, calls ws.subscribe once, arms a connection listener
// ---------------------------------------------------------------------------

describe('chat-ws-subscription attach', () => {
  it('calls ws.subscribe with the chatId exactly once on attach', () => {
    const fakeWs = makeFakeWs();
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();

    expect(fakeWs.subscribeCalls).toEqual(['chat-abc']);
  });

  it('routes non-ack events to host.onEvent after attach', () => {
    const fakeWs = makeFakeWs();
    const { host, onEventSpy } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'message.added', chatId: CHAT_ID } as DaemonEvent);

    expect(onEventSpy).toHaveBeenCalledOnce();
    expect(onEventSpy).toHaveBeenCalledWith({ type: 'message.added', chatId: CHAT_ID });
  });

  it('does not route the matching subscribe:ack to host.onEvent', () => {
    const fakeWs = makeFakeWs();
    const { host, onEventSpy } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });

    expect(onEventSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when called a second time (idempotent)', () => {
    const fakeWs = makeFakeWs();
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    sub.attach();

    // subscribe must have been sent only once
    expect(fakeWs.subscribeCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. subscribe:ack for matching chatId → resumeChat once + getPendingPermission once
//    subscribe:ack for different chatId → ignored
// ---------------------------------------------------------------------------

describe('chat-ws-subscription subscribe:ack handling', () => {
  it('calls resumeChat once with correct port and chatId when ack matches', async () => {
    const fakeWs = makeFakeWs();
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(resumeChat).toHaveBeenCalledOnce();
    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('reads getPendingPermission once after a matching ack', async () => {
    const fakeWs = makeFakeWs();
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(getPendingPermission).toHaveBeenCalledOnce();
    expect(getPendingPermission).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('does NOT call resumeChat when ack chatId does not match', async () => {
    const fakeWs = makeFakeWs();
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: 'chat-other' });
    await flushMicrotasks();

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Ack-fallback timer
//    - ws.connected===true → resumeChat after 2000ms
//    - ws.connected===false → does NOT resume
// ---------------------------------------------------------------------------

describe('chat-ws-subscription ack-fallback timer — connected', () => {
  it('calls resumeChat once after SUBSCRIBE_ACK_TIMEOUT_MS when no ack arrives and ws is connected', async () => {
    const fakeWs = makeFakeWs(true);
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    // No ack pushed — let the timer fire.
    await vi.advanceTimersByTimeAsync(2001);

    expect(resumeChat).toHaveBeenCalledOnce();
    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('does NOT call resumeChat before the full 2000ms have elapsed', async () => {
    const fakeWs = makeFakeWs(true);
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    await vi.advanceTimersByTimeAsync(1999);

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

describe('chat-ws-subscription ack-fallback timer — disconnected', () => {
  it('does NOT call resumeChat when ws.connected is false at fallback time', async () => {
    const fakeWs = makeFakeWs(false);
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    await vi.advanceTimersByTimeAsync(2001);

    expect(resumeChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Reconnect: connection listener fires while connected →
//    re-sends ws.subscribe and, after ack, calls onSubscribeRefresh once
// ---------------------------------------------------------------------------

describe('chat-ws-subscription reconnect', () => {
  it('re-sends ws.subscribe when the connection listener fires while connected', async () => {
    const fakeWs = makeFakeWs(true);
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    // First subscribe:ack to clear the initial subscribe state.
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    // Now simulate a reconnect.
    fakeWs.fireConnectionListener();

    // Second subscribe must have been sent.
    expect(fakeWs.subscribeCalls).toEqual(['chat-abc', 'chat-abc']);
  });

  it('calls onSubscribeRefresh exactly once after ack following a reconnect', async () => {
    const fakeWs = makeFakeWs(true);
    const { host, subscribeRefreshSpy } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    // Clear initial subscribe state.
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();
    subscribeRefreshSpy.mockClear();

    // Simulate reconnect.
    fakeWs.fireConnectionListener();
    // Deliver the reconnect ack.
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(subscribeRefreshSpy).toHaveBeenCalledOnce();
  });

  it('does NOT call onSubscribeRefresh after the initial ack when there are no pendings', async () => {
    // Deliberate: a clean open is already seeded by the mount/setRemoteId load().
    // Re-seeding here would clobber an actively-streaming chat with a stale REST
    // snapshot, so the initial attach refreshes ONLY to heal the handoff gap.
    const fakeWs = makeFakeWs(true);
    const { host, subscribeRefreshSpy } = makeHost(fakeWs, { hasUnreconciledPendings: () => false });
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(subscribeRefreshSpy).not.toHaveBeenCalled();
  });

  it('calls onSubscribeRefresh after the initial ack when an optimistic pending is unreconciled', async () => {
    // The first-message handoff: the first send happened during the __LOCALID_* →
    // remoteId window before the sub attached, so the daemon's `display.messages.set
    // [user]` was lost and the pending lingers. A pending at ack time is that signal,
    // and re-seeding reconciles it.
    const fakeWs = makeFakeWs(true);
    const { host, subscribeRefreshSpy } = makeHost(fakeWs, { hasUnreconciledPendings: () => true });
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(subscribeRefreshSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 5. restorePendingPermission
//    - toolUseId NOT in getRecentlyReplied() → dispatchPermission called once
//    - toolUseId IN getRecentlyReplied() → dispatchPermission NOT called
// ---------------------------------------------------------------------------

describe('chat-ws-subscription restorePendingPermission — toolUseId not recently replied', () => {
  it('calls dispatchPermission with the fetched request when toolUseId is not in recently-replied', async () => {
    const pending: ControlRequest = {
      requestId: 'rp-new',
      toolName: 'Bash',
      toolUseId: 'tu-new',
      input: { command: 'ls' },
      suggestions: [],
    };
    vi.mocked(getPendingPermission).mockResolvedValue(pending);

    const fakeWs = makeFakeWs();
    const { host, dispatchSpy } = makeHost(fakeWs, {
      getRecentlyReplied: () => new Set<string>(),
    });
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(dispatchSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledWith(pending);
  });
});

describe('chat-ws-subscription restorePendingPermission — toolUseId recently replied', () => {
  it('does NOT call dispatchPermission when toolUseId is in getRecentlyReplied()', async () => {
    const pending: ControlRequest = {
      requestId: 'rp-old',
      toolName: 'Bash',
      toolUseId: 'tu-old',
      input: { command: 'echo hi' },
      suggestions: [],
    };
    vi.mocked(getPendingPermission).mockResolvedValue(pending);

    const fakeWs = makeFakeWs();
    const { host, dispatchSpy } = makeHost(fakeWs, {
      // 'tu-old' was just answered — the restore must be suppressed.
      getRecentlyReplied: () => new Set<string>(['tu-old']),
    });
    const sub = new ChatWsSubscription(host);
    activeSub = sub;

    sub.attach();
    fakeWs.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. detach()
//    - calls ws.unsubscribe with chatId
//    - tears down event-handler unsub (subsequent events not forwarded)
//    - tears down connection-listener unsub
//    - clears the ack-fallback timer (a later fire is a no-op)
// ---------------------------------------------------------------------------

describe('chat-ws-subscription detach', () => {
  it('calls ws.unsubscribe with the chatId on detach', () => {
    const fakeWs = makeFakeWs();
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);
    // Don't assign to activeSub — we call detach manually.

    sub.attach();
    sub.detach();

    expect(fakeWs.unsubscribeCalls).toEqual(['chat-abc']);
  });

  it('stops forwarding events after detach', () => {
    const fakeWs = makeFakeWs();
    const { host, onEventSpy } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);

    sub.attach();
    sub.detach();
    fakeWs.pushEvent({ type: 'message.added', chatId: CHAT_ID } as DaemonEvent);

    expect(onEventSpy).not.toHaveBeenCalled();
  });

  it('clears the ack-fallback timer so a late fire is a no-op', async () => {
    const fakeWs = makeFakeWs(true);
    const { host } = makeHost(fakeWs);
    const sub = new ChatWsSubscription(host);

    sub.attach();
    // Detach before the 2000ms fallback.
    sub.detach();
    // Advance past the timeout — the timer was cleared, resumeChat must not fire.
    await vi.advanceTimersByTimeAsync(2001);

    expect(resumeChat).not.toHaveBeenCalled();
  });
});
