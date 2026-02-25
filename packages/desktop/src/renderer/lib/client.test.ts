import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DaemonClient } from './client.js';

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  send = vi.fn();
}

describe('DaemonClient', () => {
  let created: MockWebSocket[];

  beforeEach(() => {
    created = [];
    vi.stubGlobal(
      'WebSocket',
      class extends MockWebSocket {
        constructor() {
          super();
          created.push(this);
        }
      },
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not attempt reconnect when a replaced socket fires onclose', () => {
    const client = new DaemonClient();

    // Simulate React Strict Mode: connect → cleanup (disconnect) → re-mount (connect)
    client.connect();
    const socketA = created[0]!;
    client.disconnect();
    client.connect();

    const attemptReconnect = vi.spyOn(client as never, 'attemptReconnect');

    // Socket A's stale onclose fires asynchronously after intentionalClose was reset
    socketA.onclose?.();

    expect(attemptReconnect).not.toHaveBeenCalled();
  });

  it('reconnects when the active socket closes unexpectedly', () => {
    const client = new DaemonClient();

    client.connect();
    const socketA = created[0]!;
    socketA.readyState = 1; // OPEN
    socketA.onopen?.();

    const attemptReconnect = vi.spyOn(client as never, 'attemptReconnect');

    socketA.readyState = MockWebSocket.CLOSED;
    socketA.onclose?.();

    expect(attemptReconnect).toHaveBeenCalledOnce();
  });
});
