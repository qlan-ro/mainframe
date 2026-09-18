/**
 * AcpNotificationRouter — behavior tests (todo #350 plan review fixes, T30, R3.7).
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { JsonRpcNotification, JsonRpcRequest } from '@qlan-ro/mainframe-types';
import { AcpNotificationRouter, NOTIFICATION_METHODS, type NotificationMethod } from '../acp-notification-router';

function makeRouter() {
  const onHeartbeat = vi.fn();
  const onRequestError = vi.fn();
  const router = new AcpNotificationRouter(onHeartbeat, onRequestError);
  return { router, onHeartbeat, onRequestError };
}

describe('AcpNotificationRouter.handleRequest — session/request_permission', () => {
  it('a malformed permission request is answered with an error, not silently dropped', () => {
    const { router, onRequestError } = makeRouter();
    const listener = vi.fn();
    router.onPermissionRequest(listener);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'gate-1',
      method: 'session/request_permission',
      params: 'not-an-object',
    } as unknown as JsonRpcRequest;
    router.handleRequest(request);

    expect(onRequestError).toHaveBeenCalledWith('gate-1', -32602, expect.any(String));
    expect(listener).not.toHaveBeenCalled();
  });

  it('a valid permission request dispatches to listeners without an error reply', () => {
    const { router, onRequestError } = makeRouter();
    const listener = vi.fn();
    router.onPermissionRequest(listener);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'gate-2',
      method: 'session/request_permission',
      params: {
        sessionId: 'chat_1',
        title: 'Run a command',
        options: [{ optionId: 'allow-once', name: 'Allow', kind: 'allow_once' }],
      },
    } as unknown as JsonRpcRequest;
    router.handleRequest(request);

    expect(onRequestError).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith('gate-2', expect.objectContaining({ sessionId: 'chat_1' }));
  });

  it('ignores a request for an unrelated method', () => {
    const { router, onRequestError } = makeRouter();
    const listener = vi.fn();
    router.onPermissionRequest(listener);

    router.handleRequest({
      jsonrpc: '2.0',
      id: 'x',
      method: 'session/cancel',
      params: {},
    } as unknown as JsonRpcRequest);

    expect(onRequestError).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

const UPDATE = { sessionUpdate: 'agent_message_chunk', messageId: 'msg_1', content: { type: 'text', text: 'hi' } };
const QUEUED_REF = {
  messageId: 'msg_q1',
  chatId: 'chat_1',
  uuid: 'uuid-1',
  content: 'queued prompt',
  timestamp: '2026-09-15T00:00:00.000Z',
};

/** One wire frame per routed method, with the listener arguments the table projects out of it. */
const CASES: Record<NotificationMethod, { params: unknown; args: unknown[] }> = {
  'session/update': { params: { sessionId: 'chat_1', update: UPDATE }, args: ['chat_1', UPDATE] },
  '_mainframe.dev/heartbeat': { params: { sequence: 7 }, args: [7] },
  '_mainframe.dev/queue_state': {
    params: { sessionId: 'chat_1', refs: [QUEUED_REF] },
    args: ['chat_1', [QUEUED_REF]],
  },
  '_mainframe.dev/transcript_cleared': { params: { sessionId: 'chat_1' }, args: ['chat_1'] },
  '_mainframe.dev/compaction': { params: { sessionId: 'chat_1', phase: 'started' }, args: ['chat_1', 'started'] },
  '_mainframe.dev/gate_resolved': {
    params: { sessionId: 'chat_1', requestId: 'gate-req_001' },
    args: ['chat_1', 'gate-req_001'],
  },
  '_mainframe.dev/resync': { params: { sessionId: 'chat_1' }, args: ['chat_1'] },
};

/** `_mainframe.dev/heartbeat` has no public registrar — its listener is the constructor callback. */
const SUBSCRIBE: Record<
  Exclude<NotificationMethod, '_mainframe.dev/heartbeat'>,
  (router: AcpNotificationRouter, listener: () => void) => void
> = {
  'session/update': (router, listener) => router.onSessionUpdate(listener),
  '_mainframe.dev/queue_state': (router, listener) => router.onQueueState(listener),
  '_mainframe.dev/transcript_cleared': (router, listener) => router.onTranscriptCleared(listener),
  '_mainframe.dev/compaction': (router, listener) => router.onCompaction(listener),
  '_mainframe.dev/gate_resolved': (router, listener) => router.onGateResolved(listener),
  '_mainframe.dev/resync': (router, listener) => router.onResync(listener),
};

function subscribeAll(): { router: AcpNotificationRouter; listeners: Record<NotificationMethod, Mock> } {
  const { router, onHeartbeat } = makeRouter();
  const listeners = { '_mainframe.dev/heartbeat': onHeartbeat } as Record<NotificationMethod, Mock>;
  for (const [method, subscribe] of Object.entries(SUBSCRIBE)) {
    const listener = vi.fn();
    subscribe(router, listener);
    listeners[method as NotificationMethod] = listener;
  }
  return { router, listeners };
}

describe('AcpNotificationRouter.handleNotification — table routing', () => {
  it('every routed method has a case, and every case is routed', () => {
    expect([...NOTIFICATION_METHODS].sort()).toEqual(Object.keys(CASES).sort());
  });

  it.each([...NOTIFICATION_METHODS])('%s reaches only its own listener, with the projected params', (method) => {
    const { router, listeners } = subscribeAll();

    router.handleNotification({ jsonrpc: '2.0', method, params: CASES[method].params } as JsonRpcNotification);

    expect(listeners[method]).toHaveBeenCalledTimes(1);
    expect(listeners[method]).toHaveBeenCalledWith(...CASES[method].args);
    for (const other of NOTIFICATION_METHODS) {
      if (other !== method) expect(listeners[other]).not.toHaveBeenCalled();
    }
  });

  it('ignores an unknown method without warning or dispatch', () => {
    const { router, listeners } = subscribeAll();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    router.handleNotification({ jsonrpc: '2.0', method: '_mainframe.dev/unknown', params: {} } as JsonRpcNotification);

    expect(warn).not.toHaveBeenCalled();
    for (const method of NOTIFICATION_METHODS) expect(listeners[method]).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a malformed notification is dropped with a warning naming the method', () => {
    const { router, listeners } = subscribeAll();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    router.handleNotification({
      jsonrpc: '2.0',
      method: '_mainframe.dev/compaction',
      params: { sessionId: 'chat_1', phase: 'not-a-phase' },
    } as JsonRpcNotification);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('compaction'), expect.anything());
    expect(listeners['_mainframe.dev/compaction']).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('an unsubscribed listener stops receiving its method', () => {
    const { router } = makeRouter();
    const listener = vi.fn();
    const unsubscribe = router.onResync(listener);

    unsubscribe();
    router.handleNotification({
      jsonrpc: '2.0',
      method: '_mainframe.dev/resync',
      params: { sessionId: 'chat_1' },
    } as JsonRpcNotification);

    expect(listener).not.toHaveBeenCalled();
  });
});
