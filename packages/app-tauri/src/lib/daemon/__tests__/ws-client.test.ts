import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { DaemonWsClient } from '../ws-client';

// ---------------------------------------------------------------------------
// FakeWebSocket — minimal stand-in for the browser WebSocket global.
// The source reads `WebSocket.OPEN` etc. as statics, so the class carries
// them too. Each instance is pushed into `instances` so tests can flip
// readyState and fire handlers without reaching into private state.
// ---------------------------------------------------------------------------

type MessageEvent = { data: string };

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  // vi.fn() returns a spy that is callable AND carries .mock / .mockClear etc.
  // We cast to the plain function type for the `send` property (which is what
  // the source calls), but keep a reference under `sendSpy` for assertions.
  sendSpy = vi.fn<(data: string) => void>();
  send: (data: string) => void = this.sendSpy as unknown as (data: string) => void;

  // Exposed so tests can simulate close without triggering reconnect via the
  // intentionalClose flag that DaemonWsClient manages.
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastSocket(): FakeWebSocket {
  const s = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!s) throw new Error('No FakeWebSocket instance created yet');
  return s;
}

function openSocket(socket: FakeWebSocket): void {
  socket.readyState = FakeWebSocket.OPEN;
  socket.onopen?.();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // The source guards on `WebSocket.OPEN`, `WebSocket.CONNECTING` etc. as
  // static properties. vi.stubGlobal replaces the global constructor so those
  // statics are available via `WebSocket.OPEN` in the module under test.
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// H2 — never drop on send: buffer while not OPEN, flush on onopen
// ---------------------------------------------------------------------------

describe('DaemonWsClient — H2: buffering while not OPEN', () => {
  it('buffers a send while CONNECTING and flushes it on onopen', () => {
    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();

    const socket = lastSocket();
    // Still CONNECTING — send must NOT call socket.sendSpy yet.
    client.send({ type: 'subscribe', chatId: 'chat-1' });
    expect(socket.sendSpy).not.toHaveBeenCalled();

    // Open the connection → the pending frame should be flushed.
    openSocket(socket);
    expect(socket.sendSpy).toHaveBeenCalledOnce();
    expect(socket.sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', chatId: 'chat-1' }));
  });

  it('flushes multiple buffered messages in order on onopen', () => {
    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();

    const socket = lastSocket();

    client.send({ type: 'subscribe', chatId: 'first' });
    client.send({ type: 'subscribe', chatId: 'second' });
    expect(socket.sendSpy).not.toHaveBeenCalled();

    openSocket(socket);

    expect(socket.sendSpy).toHaveBeenCalledTimes(2);
    expect(socket.sendSpy.mock.calls[0]?.[0]).toBe(JSON.stringify({ type: 'subscribe', chatId: 'first' }));
    expect(socket.sendSpy.mock.calls[1]?.[0]).toBe(JSON.stringify({ type: 'subscribe', chatId: 'second' }));
  });

  it('sends immediately when the socket is already OPEN', () => {
    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();

    const socket = lastSocket();
    openSocket(socket);
    // Reset the spy so we only count the direct send below, not the flush.
    socket.sendSpy.mockClear();

    client.send({ type: 'unsubscribe', chatId: 'chat-2' });

    expect(socket.sendSpy).toHaveBeenCalledOnce();
    expect(socket.sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'unsubscribe', chatId: 'chat-2' }));
  });
});

// ---------------------------------------------------------------------------
// H4 — envelope guard: only well-formed {type:string} objects reach handlers
// ---------------------------------------------------------------------------

describe('DaemonWsClient — H4: envelope guard on receive', () => {
  function setupConnectedClient(): {
    client: DaemonWsClient;
    socket: FakeWebSocket;
    handler: ReturnType<typeof vi.fn>;
  } {
    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();

    const socket = lastSocket();
    openSocket(socket);

    const handler = vi.fn();
    client.onEvent(handler as (e: DaemonEvent) => void);
    return { client, socket, handler };
  }

  it('dispatches a well-formed event object with a string type to handlers', () => {
    const { socket, handler } = setupConnectedClient();

    socket.onmessage?.({ data: JSON.stringify({ type: 'chat.updated', chat: { id: 'c1' } }) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ type: 'chat.updated', chat: { id: 'c1' } });
  });

  it('drops a valid JSON string (not an object) without calling handlers', () => {
    const { socket, handler } = setupConnectedClient();

    // '"just a string"' is valid JSON but not an object.
    socket.onmessage?.({ data: '"just a string"' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('drops a JSON object missing the type field without calling handlers', () => {
    const { socket, handler } = setupConnectedClient();

    socket.onmessage?.({ data: JSON.stringify({ noType: 1 }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it('drops a JSON object with a non-string type field without calling handlers', () => {
    const { socket, handler } = setupConnectedClient();

    socket.onmessage?.({ data: JSON.stringify({ type: 42 }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it('drops unparseable JSON without throwing', () => {
    const { socket, handler } = setupConnectedClient();

    expect(() => {
      socket.onmessage?.({ data: 'not json at all{{{' });
    }).not.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });
});
