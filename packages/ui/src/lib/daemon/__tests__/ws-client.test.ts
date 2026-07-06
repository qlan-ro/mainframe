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

// ---------------------------------------------------------------------------
// H6 — stale-socket guard: a superseded socket's late frames are dropped
// ---------------------------------------------------------------------------

describe('DaemonWsClient — H6: stale-socket guard after reconnect', () => {
  it('drops a frame delivered by the old socket after reconnect, and delivers frames on the new socket', () => {
    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();

    const oldSocket = lastSocket();
    openSocket(oldSocket);

    const handler = vi.fn();
    client.onEvent(handler as (e: DaemonEvent) => void);

    // Simulate a reconnect: the old socket goes away (closed) and a fresh
    // connect() call creates a new socket instance. `this.ws` now points at
    // the new socket, so the old socket's closure captured a `socket` that no
    // longer matches `this.ws`.
    oldSocket.readyState = FakeWebSocket.CLOSED;
    client.connect();
    const newSocket = lastSocket();
    expect(newSocket).not.toBe(oldSocket);
    openSocket(newSocket);

    // A late frame arrives via the OLD socket's onmessage — must be dropped.
    oldSocket.onmessage?.({ data: JSON.stringify({ type: 'chat.updated', chat: { id: 'stale' } }) });
    expect(handler).not.toHaveBeenCalled();

    // A frame on the NEW (current) socket must still be delivered normally.
    newSocket.onmessage?.({ data: JSON.stringify({ type: 'chat.updated', chat: { id: 'fresh' } }) });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ type: 'chat.updated', chat: { id: 'fresh' } });
  });
});

// ---------------------------------------------------------------------------
// H5 — file-watch: subscribeFile / unsubscribeFile / onFileChange
// ---------------------------------------------------------------------------

describe('DaemonWsClient — H5: file-watch API', () => {
  function setupConnectedClient(): {
    client: DaemonWsClient;
    socket: FakeWebSocket;
  } {
    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();
    const socket = lastSocket();
    openSocket(socket);
    socket.sendSpy.mockClear();
    return { client, socket };
  }

  it('subscribeFile sends {type:"subscribe:file", path}', () => {
    const { client, socket } = setupConnectedClient();
    client.subscribeFile('/home/user/project/foo.ts');
    expect(socket.sendSpy).toHaveBeenCalledOnce();
    expect(socket.sendSpy).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe:file', path: '/home/user/project/foo.ts' }),
    );
  });

  it('subscribeFile includes projectId and chatId when provided', () => {
    const { client, socket } = setupConnectedClient();
    client.subscribeFile('src/index.ts', { projectId: 'proj-1', chatId: 'chat-1' });
    expect(socket.sendSpy).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe:file', path: 'src/index.ts', projectId: 'proj-1', chatId: 'chat-1' }),
    );
  });

  it('subscribeFile includes only projectId when chatId is omitted', () => {
    const { client, socket } = setupConnectedClient();
    client.subscribeFile('src/index.ts', { projectId: 'proj-1' });
    expect(socket.sendSpy).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe:file', path: 'src/index.ts', projectId: 'proj-1' }),
    );
  });

  it('unsubscribeFile sends {type:"unsubscribe:file", path}', () => {
    const { client, socket } = setupConnectedClient();
    client.unsubscribeFile('/home/user/project/foo.ts');
    expect(socket.sendSpy).toHaveBeenCalledOnce();
    expect(socket.sendSpy).toHaveBeenCalledWith(
      JSON.stringify({ type: 'unsubscribe:file', path: '/home/user/project/foo.ts' }),
    );
  });

  it('unsubscribeFile includes projectId and chatId when provided', () => {
    const { client, socket } = setupConnectedClient();
    client.unsubscribeFile('src/index.ts', { projectId: 'proj-1', chatId: 'chat-1' });
    expect(socket.sendSpy).toHaveBeenCalledWith(
      JSON.stringify({ type: 'unsubscribe:file', path: 'src/index.ts', projectId: 'proj-1', chatId: 'chat-1' }),
    );
  });

  it('invokes onFileChange listener using the resolved path from the ack', () => {
    const { client, socket } = setupConnectedClient();
    const requestedPath = '/home/user/project/foo.ts';
    const resolvedPath = '/private/home/user/project/foo.ts';

    const listener = vi.fn();
    client.onFileChange(requestedPath, listener);

    // Simulate the daemon ack that records the path mapping.
    socket.onmessage?.({
      data: JSON.stringify({ type: 'subscribe:file:ack', requestedPath, resolvedPath }),
    });

    // Simulate a file:changed arriving with the RESOLVED path.
    socket.onmessage?.({
      data: JSON.stringify({ type: 'file:changed', path: resolvedPath }),
    });

    expect(listener).toHaveBeenCalledOnce();
  });

  it('does NOT invoke the listener when file:changed carries an unrelated path', () => {
    const { client, socket } = setupConnectedClient();
    const requestedPath = '/home/user/project/foo.ts';
    const resolvedPath = '/private/home/user/project/foo.ts';

    const listener = vi.fn();
    client.onFileChange(requestedPath, listener);

    socket.onmessage?.({
      data: JSON.stringify({ type: 'subscribe:file:ack', requestedPath, resolvedPath }),
    });

    socket.onmessage?.({
      data: JSON.stringify({ type: 'file:changed', path: '/some/other/file.ts' }),
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('the returned unsubscribe fn stops further listener calls', () => {
    const { client, socket } = setupConnectedClient();
    const requestedPath = '/home/user/project/bar.ts';
    const resolvedPath = '/private/home/user/project/bar.ts';

    const listener = vi.fn();
    const unsubscribe = client.onFileChange(requestedPath, listener);

    socket.onmessage?.({
      data: JSON.stringify({ type: 'subscribe:file:ack', requestedPath, resolvedPath }),
    });

    // First fire — listener should run.
    socket.onmessage?.({ data: JSON.stringify({ type: 'file:changed', path: resolvedPath }) });
    expect(listener).toHaveBeenCalledOnce();

    // Unregister, then fire again — listener must NOT run.
    unsubscribe();
    socket.onmessage?.({ data: JSON.stringify({ type: 'file:changed', path: resolvedPath }) });
    expect(listener).toHaveBeenCalledOnce(); // still just once
  });

  // Fix 4: unsubscribeFile must clean up filePathMap to prevent stale routing
  it('unsubscribeFile removes the requestedPath entry from the internal path map', () => {
    const { client, socket } = setupConnectedClient();
    const requestedPath = '/home/user/project/stale.ts';
    const resolvedPath = '/private/home/user/project/stale.ts';

    const listener = vi.fn();
    client.onFileChange(requestedPath, listener);

    // Simulate ack — this populates filePathMap
    socket.onmessage?.({
      data: JSON.stringify({ type: 'subscribe:file:ack', requestedPath, resolvedPath }),
    });

    // Fire once — listener should run
    socket.onmessage?.({ data: JSON.stringify({ type: 'file:changed', path: resolvedPath }) });
    expect(listener).toHaveBeenCalledOnce();

    // Unsubscribe at the WS level — clears the map entry
    client.unsubscribeFile(requestedPath);

    // file:changed arrives again — must NOT route to the listener because the
    // mapping was removed (the filePathMap entry no longer exists)
    socket.onmessage?.({ data: JSON.stringify({ type: 'file:changed', path: resolvedPath }) });
    expect(listener).toHaveBeenCalledOnce(); // still just once
  });
});
