import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../websocket.js';
import type { ChatManager } from '../../chat/index.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

/**
 * Background-chat attention delivery (bug: notification/permission/lifecycle events
 * were gated by the same per-chat `subscriptions` set the client only maintains for
 * the ACTIVE thread, so a background chat's completion notice was silently dropped).
 */
describe('WebSocketManager.broadcastEvent — connection-global event types', () => {
  let server: Server;
  let manager: WebSocketManager;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    manager = new WebSocketManager(server, {} as ChatManager);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    manager.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('delivers chat.notification to a client NOT subscribed to that chatId', async () => {
    const ws = await connectWs(port);
    const received = collectMessages(ws);

    const event: DaemonEvent = {
      type: 'chat.notification',
      chatId: 'background-chat',
      title: 'Task Complete',
      body: 'done',
      level: 'success',
    };
    manager.broadcastEvent(event);

    const messages = await received;
    expect(messages.some((m) => m.type === 'chat.notification' && m.chatId === 'background-chat')).toBe(true);
    ws.close();
  });

  it('delivers permission.requested to a client NOT subscribed to that chatId', async () => {
    const ws = await connectWs(port);
    const received = collectMessages(ws);

    const event: DaemonEvent = {
      type: 'permission.requested',
      chatId: 'background-chat',
      request: { requestId: 'req-1', toolName: 'Bash', toolUseId: 'tu-1', input: {}, suggestions: [] },
      notify: true,
    };
    manager.broadcastEvent(event);

    const messages = await received;
    expect(messages.some((m) => m.type === 'permission.requested' && m.chatId === 'background-chat')).toBe(true);
    ws.close();
  });

  it('delivers chat.updated to a client NOT subscribed to that chatId', async () => {
    const ws = await connectWs(port);
    const received = collectMessages(ws);

    const event: DaemonEvent = {
      type: 'chat.updated',
      reason: 'completed',
      chat: {
        id: 'background-chat',
        adapterId: 'claude',
        projectId: 'p1',
        status: 'active',
        displayStatus: 'idle',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        totalCost: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        lastContextTokensInput: 0,
      },
    };
    manager.broadcastEvent(event);

    const messages = await received;
    expect(messages.some((m) => m.type === 'chat.updated' && m.chat.id === 'background-chat')).toBe(true);
    ws.close();
  });

  it('still withholds a per-chat event like message.added from a non-subscribed client', async () => {
    const ws = await connectWs(port);
    const received = collectMessages(ws, 150);

    const event: DaemonEvent = {
      type: 'message.added',
      chatId: 'background-chat',
      message: { id: 'm1', chatId: 'background-chat', type: 'user', content: [], timestamp: new Date().toISOString() },
    };
    manager.broadcastEvent(event);

    const messages = await received;
    expect(messages.some((m) => m.type === 'message.added')).toBe(false);
    ws.close();
  });
});

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Collects parsed JSON messages received within `windowMs` of the call. */
function collectMessages(ws: WebSocket, windowMs = 150): Promise<any[]> {
  const out: any[] = [];
  const onMessage = (data: unknown) => out.push(JSON.parse(String(data)));
  ws.on('message', onMessage);
  return new Promise((resolve) => {
    setTimeout(() => {
      ws.off('message', onMessage);
      resolve(out);
    }, windowMs);
  });
}
