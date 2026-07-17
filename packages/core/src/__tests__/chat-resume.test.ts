import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';

// ── Mock ChatManager ────────────────────────────────────────────────
// Minimal stub for WebSocketManager's `chats` dependency — only
// `getQueuedForChat` is exercised by the subscribe handler under test.

interface MockChatManager {
  getQueuedForChat: Mock<(chatId: string) => unknown[]>;
}

function createMockChatManager(): MockChatManager {
  return {
    getQueuedForChat: vi.fn().mockReturnValue([]),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function startServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// ── WS subscribe sends queued snapshot ─────────────────────────────
// The WS `subscribe` event now handles the subscription + snapshot, while
// `resumeChat` (REST) handles the auto-start logic. This test ensures the
// WS `subscribe` handler sends a queued snapshot on subscription.

describe('WS subscribe queued-snapshot', () => {
  let server: Server | undefined;
  let ws: WebSocket | undefined;

  afterEach(async () => {
    ws?.close();
    await new Promise<void>((resolve) => {
      if (server?.listening) server.close(() => resolve());
      else resolve();
    });
  });

  it('WS subscribe sends message.queued.snapshot for the chat', async () => {
    const chats = createMockChatManager();
    const { server: srv, port } = await startServer();
    server = srv;
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    const events: unknown[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({ type: 'subscribe', chatId: 'chat-1' }));
    await new Promise((r) => setTimeout(r, 50));

    const snapshot = events.find((e: any) => e.type === 'message.queued.snapshot');
    expect(snapshot).toBeDefined();
  });
});
