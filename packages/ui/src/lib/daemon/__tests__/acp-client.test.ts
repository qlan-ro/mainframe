import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AcpFacadeClient } from '../acp-client';
import type { AcpSocketLike } from '../acp-rpc-connection';

// ---------------------------------------------------------------------------
// FakeSocket — constructor-injected stand-in for the WS transport. Unlike
// ws-client.test.ts's global `vi.stubGlobal('WebSocket', ...)`, AcpFacadeClient
// takes its socket factory as a constructor dep (advisor guidance: injectable,
// not global monkey-patching) — so tests just pass one in.
// ---------------------------------------------------------------------------

class FakeSocket implements AcpSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function initializeResult(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2,
    info: { name: 'mainframe-daemon', version: '1.0.0' },
    capabilities: { session: {} },
    _meta: { '_mainframe.dev': { heartbeatIntervalMs: 15000 } },
    ...overrides,
  };
}

/**
 * `socket.open()` resolves `RpcConnection.open()`'s promise, but `connect()`'s
 * `await` only resumes on the next microtask — a plain `await Promise.resolve()`
 * flushes it (fake timers only intercept macrotasks, not microtasks) so
 * `socket.sent` is populated before the caller reads it.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

/** Connects a client against a fresh FakeSocket, auto-answering `initialize`. */
async function connectedClient(): Promise<{ client: AcpFacadeClient; socket: FakeSocket }> {
  const socket = new FakeSocket();
  const client = new AcpFacadeClient('mock-cli', { url: () => 'ws://test/acp/mock-cli', createSocket: () => socket });
  const connectPromise = client.connect();
  socket.open();
  await flushMicrotasks();
  const initReq = socket.sent[0] as { id: number };
  socket.receive({ jsonrpc: '2.0', id: initReq.id, result: initializeResult() });
  await connectPromise;
  return { client, socket };
}

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

describe('AcpFacadeClient — heartbeat + gap detection (criterion 11 client half)', () => {
  it('does not signal a gap for consecutive heartbeat sequences', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 1 } });
    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 2 } });

    expect(gaps).not.toHaveBeenCalled();
  });

  it('signals a gap when a heartbeat sequence jumps by more than one', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 1 } });
    expect(gaps).not.toHaveBeenCalled();

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 3 } });
    expect(gaps).toHaveBeenCalledTimes(1);
  });

  it('signals a gap on silence past 2x the advertised heartbeat interval', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    client.onGap(gaps);

    socket.receive({ jsonrpc: '2.0', method: '_mainframe.dev/heartbeat', params: { sequence: 1 } });
    vi.advanceTimersByTime(15000 * 2 - 1);
    expect(gaps).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(gaps).toHaveBeenCalledTimes(1);
  });

  it('signals a gap when the connection closes', async () => {
    const { client, socket } = await connectedClient();
    const gaps = vi.fn();
    const closed = vi.fn();
    client.onGap(gaps);
    client.onClose(closed);

    socket.close();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(gaps).toHaveBeenCalledTimes(1);
  });
});

describe('AcpFacadeClient — session/prompt, session/cancel, session/resume', () => {
  it('prompt() sends a text content block and parses the acceptance response', async () => {
    const { client, socket } = await connectedClient();
    const promptPromise = client.prompt('chat_1', 'hello');
    const req = socket.sent[socket.sent.length - 1] as { id: number; method: string; params: unknown };
    expect(req).toMatchObject({
      method: 'session/prompt',
      params: { sessionId: 'chat_1', prompt: [{ type: 'text', text: 'hello' }] },
    });

    socket.receive({ jsonrpc: '2.0', id: req.id, result: { _meta: { '_mainframe.dev': { position: 2 } } } });
    await expect(promptPromise).resolves.toEqual({ _meta: { '_mainframe.dev': { position: 2 } } });
  });

  it('cancel() sends a notification (no id, no reply expected)', async () => {
    const { client, socket } = await connectedClient();
    client.cancel('chat_1');
    expect(socket.sent[socket.sent.length - 1]).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'chat_1' },
    });
  });

  it('resume() carries the replayFrom cursor and parses the response', async () => {
    const { client, socket } = await connectedClient();
    const resumePromise = client.resume('chat_1', '/repo', { type: 'start' });
    const req = socket.sent[socket.sent.length - 1] as { id: number };
    expect(req).toMatchObject({
      method: 'session/resume',
      params: { sessionId: 'chat_1', cwd: '/repo', replayFrom: { type: 'start' } },
    });

    socket.receive({ jsonrpc: '2.0', id: req.id, result: {} });
    await expect(resumePromise).resolves.toEqual({});
  });
});
