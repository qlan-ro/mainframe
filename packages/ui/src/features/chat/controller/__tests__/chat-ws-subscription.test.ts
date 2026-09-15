/**
 * Behavior tests for ChatWsSubscription (desktop-cutover pass).
 *
 * The module shrank from a full reconnect/ack orchestrator (subscribe:ack
 * gating with a 2s fallback timer, restorePendingPermission,
 * getRecentlyReplied/hasUnreconciledPendings) to the side-band attachment
 * only: subscribe + warm immediately, swallow the chat's own subscribe:ack,
 * forward every other event, and re-subscribe+warm on reconnect. The
 * retired mechanisms' behaviors (permission redelivery, reconcile-on-reseed)
 * are covered where they now live: AcpSessionPlane (resume redelivery) and
 * AcpChatController's reconcile suite (dispatchFromPlane).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

vi.mock('../../../../lib/api/chats', () => ({
  resumeChat: vi.fn().mockResolvedValue(undefined),
}));

import { resumeChat } from '../../../../lib/api/chats';
import { ChatWsSubscription, type ChatWsHost } from '../chat-ws-subscription';

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

  return {
    fakeClient,
    subscribeCalls,
    unsubscribeCalls,
    pushEvent(event) {
      // No-op once torn down (post-detach) — matches a real WS client, which
      // simply has no listener left to call.
      eventHandler?.(event);
    },
    fireConnectionListener() {
      isConnected = true;
      if (!connListener) throw new Error('connection listener not registered — call attach() first');
      connListener();
    },
  };
}

const CHAT_ID = 'chat-ws-sub';
const PORT = 9999;

function makeHost(ws: FakeWs, overrides: Partial<ChatWsHost> = {}): ChatWsHost & { events: DaemonEvent[] } {
  const events: DaemonEvent[] = [];
  return {
    chatId: CHAT_ID,
    port: PORT,
    ws: ws.fakeClient,
    onEvent: (e) => events.push(e),
    isDisposed: () => false,
    events,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatWsSubscription.attach — subscribes and warms immediately', () => {
  it('calls ws.subscribe(chatId) and resumeChat(port, chatId) with no ack wait', () => {
    const ws = makeFakeWs();
    const sub = new ChatWsSubscription(makeHost(ws));

    sub.attach();

    expect(ws.subscribeCalls).toEqual([CHAT_ID]);
    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('is idempotent — a second attach() does not re-subscribe', () => {
    const ws = makeFakeWs();
    const sub = new ChatWsSubscription(makeHost(ws));

    sub.attach();
    sub.attach();

    expect(ws.subscribeCalls).toEqual([CHAT_ID]);
  });
});

describe('ChatWsSubscription — event routing', () => {
  it('swallows this chat’s own subscribe:ack', () => {
    const ws = makeFakeWs();
    const host = makeHost(ws);
    new ChatWsSubscription(host).attach();

    ws.pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });

    expect(host.events).toEqual([]);
  });

  it('forwards a subscribe:ack for a different chat', () => {
    const ws = makeFakeWs();
    const host = makeHost(ws);
    new ChatWsSubscription(host).attach();

    ws.pushEvent({ type: 'subscribe:ack', chatId: 'other-chat' });

    expect(host.events).toEqual([{ type: 'subscribe:ack', chatId: 'other-chat' }]);
  });

  it('forwards every other event to the host', () => {
    const ws = makeFakeWs();
    const host = makeHost(ws);
    new ChatWsSubscription(host).attach();

    ws.pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    expect(host.events).toEqual([{ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' }]);
  });

  it('drops events once the host reports disposed', () => {
    const ws = makeFakeWs();
    let disposed = false;
    const host = makeHost(ws, { isDisposed: () => disposed });
    new ChatWsSubscription(host).attach();

    disposed = true;
    ws.pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    expect(host.events).toEqual([]);
  });
});

describe('ChatWsSubscription — reconnect', () => {
  it('re-subscribes and re-warms when the connection listener fires while connected', () => {
    const ws = makeFakeWs();
    const sub = new ChatWsSubscription(makeHost(ws));
    sub.attach();
    vi.mocked(resumeChat).mockClear();
    ws.subscribeCalls.length = 0;

    ws.fireConnectionListener();

    expect(ws.subscribeCalls).toEqual([CHAT_ID]);
    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });
});

describe('ChatWsSubscription.detach', () => {
  it('unsubscribes and stops forwarding further events', () => {
    const ws = makeFakeWs();
    const host = makeHost(ws);
    const sub = new ChatWsSubscription(host);
    sub.attach();

    sub.detach();

    expect(ws.unsubscribeCalls).toEqual([CHAT_ID]);
    ws.pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });
    expect(host.events).toEqual([]);
  });
});
