import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal WebSocket mock
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  // Event handlers assigned by DaemonClient
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
}

vi.stubGlobal('WebSocket', MockWebSocket);

// Must import after stubbing WebSocket
const { DaemonClient } = await import('../../renderer/lib/client.js');

function connectClient(client: InstanceType<typeof DaemonClient>): MockWebSocket {
  client.connect();
  // Get the socket created by connect()
  const ws = (client as unknown as { ws: MockWebSocket }).ws;
  ws.onopen?.();
  return ws;
}

describe('DaemonClient visited chats', () => {
  let client: InstanceType<typeof DaemonClient>;

  beforeEach(() => {
    client = new DaemonClient();
  });

  it('tracks chatId in visitedChats on resumeChat', () => {
    const ws = connectClient(client);
    ws.sent = [];

    client.resumeChat('chat-1');

    expect(client.visitedChats.has('chat-1')).toBe(true);
  });

  it('re-subscribes visited chats on reconnect', () => {
    const ws1 = connectClient(client);
    client.resumeChat('chat-1');
    client.resumeChat('chat-2');

    // Simulate disconnect + reconnect
    ws1.readyState = MockWebSocket.CLOSED;
    (client as unknown as { ws: MockWebSocket | null }).ws = null;
    const ws2 = connectClient(client);
    ws2.sent = [];

    // Trigger the resubscribe that happens after flush
    // Reset and re-trigger to isolate
    (client as unknown as { ws: MockWebSocket | null }).ws = null;
    const ws3 = connectClient(client);

    const subscribes = ws3.sent.map((s) => JSON.parse(s)).filter((e: { type: string }) => e.type === 'subscribe');

    expect(subscribes).toHaveLength(2);
    expect(subscribes.map((s: { chatId: string }) => s.chatId).sort()).toEqual(['chat-1', 'chat-2']);
  });

  it('uses lightweight subscribe (not chat.resume) on reconnect', () => {
    connectClient(client);
    client.resumeChat('chat-1');

    // Reconnect
    (client as unknown as { ws: MockWebSocket | null }).ws = null;
    const ws2 = connectClient(client);

    const resumes = ws2.sent.map((s) => JSON.parse(s)).filter((e: { type: string }) => e.type === 'chat.resume');

    // No chat.resume on reconnect — only lightweight subscribe
    expect(resumes).toHaveLength(0);
  });

  it('removes chatId from visitedChats on unsubscribe', () => {
    connectClient(client);
    client.resumeChat('chat-1');
    expect(client.visitedChats.has('chat-1')).toBe(true);

    client.unsubscribe('chat-1');
    expect(client.visitedChats.has('chat-1')).toBe(false);
  });
});
