import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActiveDaemon } from '../active-daemon';
import { DaemonWsClient } from '../ws-client';

// ---------------------------------------------------------------------------
// Minimal capturing fake — only needs to record the URL passed to the
// constructor. close/addEventListener/send are no-ops so the client's guards
// don't throw when the socket is accessed after construction.
// ---------------------------------------------------------------------------

const urls: string[] = [];

class FakeWS {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWS.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(u: string) {
    urls.push(u);
  }
  close() {}
  addEventListener() {}
  send() {}
}

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A3 — ws-client reads URL from the active daemon target
// ---------------------------------------------------------------------------

describe('DaemonWsClient — A3: URL built from the active daemon target', () => {
  it('uses wss:// and appends ?token= when the active target is remote with a token', () => {
    setActiveDaemon({
      id: 'studio',
      kind: 'remote',
      label: 'Studio',
      baseUrl: 'https://studio.example.com',
      token: 'jwt123',
    });

    const client = new DaemonWsClient();
    client.setPort(0); // port is irrelevant for remote targets
    client.connect();

    expect(urls[urls.length - 1]).toBe('wss://studio.example.com?token=jwt123');
  });

  it('uses ws:// and omits ?token= when the active target is local (token null)', () => {
    setActiveDaemon({
      id: 'local',
      kind: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:31415',
      token: null,
    });

    const client = new DaemonWsClient();
    client.setPort(31415);
    client.connect();

    expect(urls[urls.length - 1]).toBe('ws://127.0.0.1:31415');
  });

  it('percent-encodes special characters in the token', () => {
    setActiveDaemon({
      id: 'remote',
      kind: 'remote',
      label: 'Remote',
      baseUrl: 'https://remote.example.com',
      token: 'tok/en=val&other',
    });

    const client = new DaemonWsClient();
    client.setPort(0);
    client.connect();

    expect(urls[urls.length - 1]).toBe(`wss://remote.example.com?token=${encodeURIComponent('tok/en=val&other')}`);
  });
});
