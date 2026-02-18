import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import type { Chat } from '@mainframe/types';
import { EventEmitter } from 'node:events';

// ── Mock ChatManager ────────────────────────────────────────────────

interface MockChatManager {
  loadChat: Mock<(chatId: string) => Promise<void>>;
  getChat: Mock<(chatId: string) => Chat | null>;
  startChat: Mock<(chatId: string) => Promise<void>>;
  clearPendingPermission: Mock<(chatId: string) => void>;
  hasPendingPermission: Mock<(chatId: string) => boolean>;
  resumeChat: Mock<(chatId: string) => Promise<void>>;
  on: Mock<(event: string, listener: (...args: unknown[]) => void) => MockChatManager>;
  emit: Mock<(...args: unknown[]) => boolean>;
}

function createMockChatManager(chatOverride?: Partial<Chat>): MockChatManager {
  const chat: Chat | null = chatOverride
    ? {
        id: 'chat-1',
        adapterId: 'claude',
        projectId: 'proj-1',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalCost: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        ...chatOverride,
      }
    : null;

  const emitter = new EventEmitter();
  const mock: MockChatManager = {
    loadChat: vi.fn().mockResolvedValue(undefined),
    getChat: vi.fn().mockReturnValue(chat),
    startChat: vi.fn().mockResolvedValue(undefined),
    clearPendingPermission: vi.fn(),
    hasPendingPermission: vi.fn().mockReturnValue(false),
    resumeChat: vi.fn(async (chatId: string) => {
      await mock.loadChat(chatId);
      const c = mock.getChat(chatId);
      if (c?.processState === 'working') {
        if (c.permissionMode === 'yolo') {
          mock.clearPendingPermission(chatId);
          await mock.startChat(chatId);
        } else if (!mock.hasPendingPermission(chatId)) {
          await mock.startChat(chatId);
        }
      }
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return mock;
    }),
    emit: vi.fn(),
  };

  return mock;
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

function sendAndWait(ws: WebSocket, event: Record<string, unknown>, delayMs = 50): Promise<void> {
  return new Promise((resolve) => {
    ws.send(JSON.stringify(event));
    setTimeout(resolve, delayMs);
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('chat.resume auto-start', () => {
  let server: Server;
  let port: number;
  let ws: WebSocket;

  afterEach(async () => {
    ws?.close();
    await new Promise<void>((resolve) => {
      if (server?.listening) server.close(() => resolve());
      else resolve();
    });
  });

  it('auto-starts YOLO sessions with processState=working', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: 'working',
    });
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.clearPendingPermission).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('auto-starts Plan sessions with processState=working and no pending permission', async () => {
    const chats = createMockChatManager({
      permissionMode: 'plan',
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(false);
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
    expect(chats.clearPendingPermission).not.toHaveBeenCalled();
  });

  it('auto-starts default mode sessions with processState=working and no pending permission', async () => {
    const chats = createMockChatManager({
      permissionMode: 'default',
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(false);
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('does NOT auto-start non-YOLO sessions with pending permission', async () => {
    const chats = createMockChatManager({
      permissionMode: 'plan',
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(true);
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).not.toHaveBeenCalled();
  });

  it('does NOT auto-start sessions with processState=idle', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: 'idle',
    });
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).not.toHaveBeenCalled();
  });

  it('does NOT auto-start sessions with processState=null', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: null,
    });
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).not.toHaveBeenCalled();
  });

  it('YOLO + working clears pending permission even if one exists', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(true);
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    expect(chats.clearPendingPermission).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('subscribes client to chatId on resume', async () => {
    const chats = createMockChatManager({ processState: 'idle' });
    ({ server, port } = await startServer());
    new WebSocketManager(server, chats as any);
    ws = await connectWs(port);

    await sendAndWait(ws, { type: 'chat.resume', chatId: 'chat-1' });

    // loadChat should be called, proving the subscription path was reached
    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
  });
});
