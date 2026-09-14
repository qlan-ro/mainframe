/**
 * AcpSessionPlane — gate request/resolve + userMessageContents. Split out of
 * acp-session-plane.test.ts (todo #350, plan task 37, R2.13) to keep that
 * file under the 300-line cap.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatStateEvent } from '../chat-thread-state';
import { AcpSessionPlane, type AcpSessionPlaneHost } from '../acp-session-plane';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

type DispatchMock = ReturnType<typeof vi.fn<(event: ChatStateEvent) => void>>;

function makeHost(): AcpSessionPlaneHost & { dispatch: DispatchMock } {
  return {
    getChatId: () => CHAT_ID,
    dispatch: vi.fn<(event: ChatStateEvent) => void>(),
    isDisposed: () => false,
  };
}

function eventsOf(host: ReturnType<typeof makeHost>): ChatStateEvent[] {
  return host.dispatch.mock.calls.map((c) => c[0]);
}

describe('AcpSessionPlane — gates', () => {
  function permissionRequest(overrides: Partial<{ requestId: string; toolName: string }> = {}) {
    const requestId = overrides.requestId ?? 'req-1';
    return {
      sessionId: CHAT_ID,
      title: 'Run a command',
      options: [{ optionId: 'allow-once', name: 'Allow', kind: 'allow_once' as const }],
      _meta: {
        '_mainframe.dev': {
          controlRequest: {
            requestId,
            toolName: overrides.toolName ?? 'Bash',
            toolUseId: 'tu-1',
            input: { command: 'ls' },
            suggestions: [],
          },
        },
      },
    };
  }

  it('dispatches permission.requested with the carried ControlRequest and the wire-level options', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    host.dispatch.mockClear();

    client.emitPermissionRequest('rpc-1', permissionRequest());

    expect(eventsOf(host)).toEqual([
      {
        type: 'permission.requested',
        requestId: 'req-1',
        request: { requestId: 'req-1', toolName: 'Bash', toolUseId: 'tu-1', input: { command: 'ls' }, suggestions: [] },
        options: [{ optionId: 'allow-once', name: 'Allow', kind: 'allow_once' }],
        synthesizedRequest: false,
      },
    ]);
  });

  it('renders a gate from options alone when _meta carries no controlRequest (spec decision 27)', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    host.dispatch.mockClear();

    client.emitPermissionRequest('gate-req-bare', {
      sessionId: CHAT_ID,
      title: 'Run',
      options: [{ optionId: 'a', name: 'A', kind: 'allow_once' as const }],
    });

    expect(eventsOf(host)).toEqual([
      {
        type: 'permission.requested',
        requestId: 'req-bare',
        request: {
          requestId: 'req-bare',
          toolName: '(unknown tool)',
          toolUseId: 'req-bare',
          input: {},
          suggestions: [],
        },
        options: [{ optionId: 'a', name: 'A', kind: 'allow_once' }],
        synthesizedRequest: true,
      },
    ]);
  });

  it('a synthesized gate still replies under the arrival rpc id with a plain-mappable optionId', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitPermissionRequest('gate-req-bare', {
      sessionId: CHAT_ID,
      title: 'Run',
      options: [{ optionId: 'allow-once', name: 'Allow', kind: 'allow_once' as const }],
    });

    plane.replyToPermission({ requestId: 'req-bare', toolUseId: 'req-bare', behavior: 'allow' }, 'allow-once');

    expect(client.respondCalls).toHaveLength(1);
    expect(client.respondCalls[0]!.id).toBe('gate-req-bare');
    expect(client.respondCalls[0]!.response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
  });

  it('replyToPermission answers under the rpc id the gate arrived on, and dispatches permission.resolved', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    client.emitPermissionRequest('rpc-42', permissionRequest({ requestId: 'req-9' }));
    host.dispatch.mockClear();

    plane.replyToPermission({ requestId: 'req-9', toolUseId: 'tu-1', behavior: 'allow' });

    expect(client.respondCalls).toHaveLength(1);
    expect(client.respondCalls[0]!.id).toBe('rpc-42');
    expect(client.respondCalls[0]!.response).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
      _meta: {
        '_mainframe.dev': { controlResponse: { requestId: 'req-9', toolUseId: 'tu-1', behavior: 'allow' } },
      },
    });
    expect(eventsOf(host)).toContainEqual({ type: 'permission.resolved', requestId: 'req-9' });
  });

  it('replyToPermission forwards the clicked optionId instead of synthesizing one (spec decision 12)', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    client.emitPermissionRequest('rpc-7', permissionRequest({ requestId: 'req-7' }));

    // An allow-behavior response answered via the "allow-always" button must
    // carry that option's id, not the behavior-derived 'allow-once'.
    plane.replyToPermission({ requestId: 'req-7', toolUseId: 'tu-1', behavior: 'allow' }, 'allow-always');

    expect(client.respondCalls[0]!.response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-always' });
  });

  it('replyToPermission falls back to gate-{requestId} when the gate was never tracked (redelivered after reload)', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    plane.replyToPermission({ requestId: 'req-orphan', toolUseId: 'tu-1', behavior: 'deny' });

    expect(client.respondCalls[0]!.id).toBe('gate-req-orphan');
    expect(client.respondCalls[0]!.response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
  });

  it('a gate resolved elsewhere clears the tracked rpc id and dispatches permission.resolved', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    client.emitPermissionRequest('rpc-5', permissionRequest({ requestId: 'req-5' }));
    host.dispatch.mockClear();

    client.emitGateResolved(CHAT_ID, 'gate-req-5');

    expect(eventsOf(host)).toEqual([{ type: 'permission.resolved', requestId: 'req-5' }]);
  });
});

describe('AcpSessionPlane.userMessageContents', () => {
  it('returns raw user text — sentinels and all — for the reconcile matcher', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'user_message',
      messageId: 'u1',
      content: [{ type: 'text', text: 'hello world' }],
    });
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'a1',
      content: [{ type: 'text', text: 'reply' }],
    });

    expect(plane.userMessageContents()).toEqual([{ content: [{ type: 'text', text: 'hello world' }] }]);
  });
});
