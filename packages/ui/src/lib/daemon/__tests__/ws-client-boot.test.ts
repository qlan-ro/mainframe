/**
 * Boot-race guard: the active-daemon singleton starts at the unseeded default
 * `http://127.0.0.1:0` until the first successful /health poll seeds it, but
 * App.tsx calls daemonWs.connect() as soon as the bridge port resolves. The
 * client must NEVER open a socket to `ws://…:0` (a guaranteed CSP violation on
 * every fresh load) — it defers the connect until the target is seeded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';
import { setActiveDaemon } from '../active-daemon';
import { DaemonWsClient } from '../ws-client';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sendSpy = vi.fn<(data: string) => void>();
  send: (data: string) => void = this.sendSpy as unknown as (data: string) => void;
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

const UNSEEDED: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:0',
  token: null,
};

const SEEDED_LOCAL: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
};

let client: DaemonWsClient;

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  setActiveDaemon(UNSEEDED);
  client = new DaemonWsClient();
});

afterEach(() => {
  client.disconnect();
  vi.unstubAllGlobals();
});

describe('DaemonWsClient — boot race (unseeded active daemon)', () => {
  it('connect() before the target is seeded opens no socket', () => {
    client.setPort(31415);
    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connects automatically (with the real URL) once the target is seeded', () => {
    client.setPort(31415);
    client.connect();

    setActiveDaemon(SEEDED_LOCAL);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:31415');
  });

  it('never attempts a ws URL with port 0, even via the send() reconnect kick', () => {
    client.setPort(31415);
    client.connect();
    // send() while down buffers and kicks a reconnect — that kick must also defer.
    client.send({ type: 'subscribe', chatId: 'chat-1' });

    expect(FakeWebSocket.instances).toHaveLength(0);

    setActiveDaemon(SEEDED_LOCAL);

    expect(FakeWebSocket.instances.every((s) => !s.url.includes(':0'))).toBe(true);
  });

  it('flushes messages buffered during the deferral once the deferred socket opens', () => {
    client.setPort(31415);
    client.connect();
    client.send({ type: 'subscribe', chatId: 'chat-1' });

    setActiveDaemon(SEEDED_LOCAL);
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket!.readyState = FakeWebSocket.OPEN;
    socket!.onopen?.();

    expect(socket!.sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', chatId: 'chat-1' }));
  });

  it('disconnect() during the deferral cancels the pending connect', () => {
    client.setPort(31415);
    client.connect();
    client.disconnect();

    setActiveDaemon(SEEDED_LOCAL);

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('only one socket is opened when connect() was called repeatedly during the deferral', () => {
    client.setPort(31415);
    client.connect();
    client.connect();
    client.connect();

    setActiveDaemon(SEEDED_LOCAL);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('keeps waiting through a still-unseeded notification (no socket, no re-subscribe loop)', () => {
    client.setPort(31415);
    client.connect();

    // Set iteration visits listeners added during the notify loop — an
    // unguarded listener that cancels + reconnects on an unseeded target
    // re-subscribes inside that loop and never terminates.
    setActiveDaemon({ ...UNSEEDED });

    expect(FakeWebSocket.instances).toHaveLength(0);

    setActiveDaemon(SEEDED_LOCAL);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:31415');
  });
});
