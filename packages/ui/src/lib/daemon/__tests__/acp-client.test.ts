/**
 * AcpFacadeClient — handshake, session/update dispatch, and daemon-initiated
 * session/request_permission. Heartbeat/gap and prompt/cancel/resume are in
 * the sibling acp-client-gap.test.ts (todo #350, plan task 37, R2.13 —
 * split to keep each file under the 300-line cap). Shared FakeSocket +
 * connectedClient() live in acp-client-test-kit.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AcpFacadeClient } from '../acp-client';
import { FakeSocket, initializeResult, flushMicrotasks, connectedClient } from './acp-client-test-kit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AcpFacadeClient — handshake', () => {
  it('sends initialize with the pinned protocol version and resolves with the response', async () => {
    const { client, socket } = await connectedClient();

    expect(socket.sent[0]).toMatchObject({ method: 'initialize', params: { protocolVersion: 2 } });
    expect(client.mainframeCapabilities).toEqual({ heartbeatIntervalMs: 15000 });
  });

  it('rejects when the daemon negotiates an unsupported protocol version', async () => {
    const socket = new FakeSocket();
    const client = new AcpFacadeClient('mock-cli', { url: () => 'ws://test', createSocket: () => socket });
    const connectPromise = client.connect();
    socket.open();
    await flushMicrotasks();
    const initReq = socket.sent[0] as { id: number };
    socket.receive({ jsonrpc: '2.0', id: initReq.id, result: initializeResult({ protocolVersion: 99 }) });

    await expect(connectPromise).rejects.toThrow(/unsupported protocol version/);
  });

  it('rejects connect() when the daemon replies with a structured error', async () => {
    const socket = new FakeSocket();
    const client = new AcpFacadeClient('mock-cli', { url: () => 'ws://test', createSocket: () => socket });
    const connectPromise = client.connect();
    socket.open();
    await flushMicrotasks();
    const initReq = socket.sent[0] as { id: number };
    socket.receive({
      jsonrpc: '2.0',
      id: initReq.id,
      error: { code: -32001, message: 'unsupported protocol version' },
    });

    await expect(connectPromise).rejects.toMatchObject({ code: -32001 });
  });

  it('a failed initialize closes its own socket and leaves the client unconnected (R3.4)', async () => {
    const socket = new FakeSocket();
    const client = new AcpFacadeClient('mock-cli', { url: () => 'ws://test', createSocket: () => socket });
    const connectPromise = client.connect();
    socket.open();
    await flushMicrotasks();
    const initReq = socket.sent[0] as { id: number };
    socket.receive({ jsonrpc: '2.0', id: initReq.id, result: initializeResult({ protocolVersion: 99 }) });

    await expect(connectPromise).rejects.toThrow(/unsupported protocol version/);
    expect(socket.closed).toBe(true);
    expect(client.connected).toBe(false);
    await expect(client.prompt('chat_1', 'hi')).rejects.toThrow(/not connected/);
  });

  it('a leaked closing socket from a failed connect() attempt cannot tear down a later successful retry', async () => {
    const deadSocket = new FakeSocket();
    const liveSocket = new FakeSocket();
    const sockets = [deadSocket, liveSocket];
    const client = new AcpFacadeClient('mock-cli', {
      url: () => 'ws://test',
      createSocket: () => sockets.shift()!,
    });

    const failedConnect = client.connect();
    deadSocket.open();
    await flushMicrotasks();
    const deadInitReq = deadSocket.sent[0] as { id: number };
    deadSocket.receive({ jsonrpc: '2.0', id: deadInitReq.id, result: initializeResult({ protocolVersion: 99 }) });
    await expect(failedConnect).rejects.toThrow(/unsupported protocol version/);

    const retry = client.connect();
    liveSocket.open();
    await flushMicrotasks();
    const liveInitReq = liveSocket.sent[0] as { id: number };
    liveSocket.receive({ jsonrpc: '2.0', id: liveInitReq.id, result: initializeResult() });
    await retry;
    expect(client.connected).toBe(true);

    // The dead socket's close event arrives late (a race that predates T27) — must be a no-op now.
    deadSocket.onclose?.();

    expect(client.connected).toBe(true);
  });
});

describe('AcpFacadeClient — session/update dispatch', () => {
  it('delivers a validated session/update to listeners', async () => {
    const { client, socket } = await connectedClient();
    const seen: unknown[] = [];
    client.onSessionUpdate((sessionId, update) => seen.push({ sessionId, update }));

    socket.receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'chat_1',
        update: { sessionUpdate: 'agent_message_chunk', messageId: 'msg_1', content: { type: 'text', text: 'hi' } },
      },
    });

    expect(seen).toEqual([
      {
        sessionId: 'chat_1',
        update: { sessionUpdate: 'agent_message_chunk', messageId: 'msg_1', content: { type: 'text', text: 'hi' } },
      },
    ]);
  });

  it('drops a session/update notification that fails schema validation', async () => {
    const { client, socket } = await connectedClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    client.onSessionUpdate((sessionId, update) => seen.push({ sessionId, update }));

    socket.receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'chat_1' /* missing update */ } });

    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops a frame with no recognizable JSON-RPC shape without throwing', async () => {
    const { socket } = await connectedClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => socket.receive({ foo: 'bar' })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('AcpFacadeClient — session/request_permission (daemon-initiated)', () => {
  it('delivers the request to listeners and lets the client answer it', async () => {
    const { client, socket } = await connectedClient();
    const requests: Array<{ id: unknown; title: string }> = [];
    client.onPermissionRequest((id, request) => requests.push({ id, title: request.title }));

    socket.receive({
      jsonrpc: '2.0',
      id: 'gate-req_001',
      method: 'session/request_permission',
      params: {
        sessionId: 'chat_1',
        title: 'Allow Bash to run this command?',
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    });

    expect(requests).toEqual([{ id: 'gate-req_001', title: 'Allow Bash to run this command?' }]);

    client.respondPermission('gate-req_001', { outcome: { outcome: 'selected', optionId: 'allow-once' } });
    expect(socket.sent[socket.sent.length - 1]).toEqual({
      jsonrpc: '2.0',
      id: 'gate-req_001',
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
    });
  });
});
