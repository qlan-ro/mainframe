/**
 * AcpNotificationRouter — behavior tests (todo #350 plan review fixes, T30, R3.7).
 */
import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcRequest } from '@qlan-ro/mainframe-types';
import { AcpNotificationRouter } from '../acp-notification-router';

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
