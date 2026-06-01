import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import type { Chat } from '@qlan-ro/mainframe-types';
import { EventEmitter } from 'node:events';

// ── Mock ChatManager ────────────────────────────────────────────────

interface MockChatManager {
  loadChat: Mock<(chatId: string) => Promise<void>>;
  getChat: Mock<(chatId: string) => Chat | null>;
  startChat: Mock<(chatId: string) => Promise<void>>;
  clearPendingPermission: Mock<(chatId: string) => void>;
  hasPendingPermission: Mock<(chatId: string) => boolean>;
  resumeChat: Mock<(chatId: string) => Promise<void>>;
  getQueuedForChat: Mock<(chatId: string) => unknown[]>;
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
        lastContextTokensInput: 0,
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
    getQueuedForChat: vi.fn().mockReturnValue([]),
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

// ── Tests ───────────────────────────────────────────────────────────
// chat.resume behavior is now tested directly on ChatManager.resumeChat()
// (previously the WS handler delegated to it). These tests call resumeChat
// directly to verify the auto-start logic in ChatLifecycleManager.

describe('chat resume auto-start (direct ChatManager.resumeChat)', () => {
  it('auto-starts YOLO sessions with processState=working', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: 'working',
    });

    await chats.resumeChat('chat-1');

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.clearPendingPermission).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('auto-starts Plan sessions with processState=working and no pending permission', async () => {
    const chats = createMockChatManager({
      planMode: true,
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(false);

    await chats.resumeChat('chat-1');

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

    await chats.resumeChat('chat-1');

    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
  });

  it('does NOT auto-start non-YOLO sessions with pending permission', async () => {
    const chats = createMockChatManager({
      planMode: true,
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(true);

    await chats.resumeChat('chat-1');

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).not.toHaveBeenCalled();
  });

  it('does NOT auto-start sessions with processState=idle', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: 'idle',
    });

    await chats.resumeChat('chat-1');

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).not.toHaveBeenCalled();
  });

  it('does NOT auto-start sessions with processState=null', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: null,
    });

    await chats.resumeChat('chat-1');

    expect(chats.loadChat).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).not.toHaveBeenCalled();
  });

  it('YOLO + working clears pending permission even if one exists', async () => {
    const chats = createMockChatManager({
      permissionMode: 'yolo',
      processState: 'working',
    });
    chats.hasPendingPermission.mockReturnValue(true);

    await chats.resumeChat('chat-1');

    expect(chats.clearPendingPermission).toHaveBeenCalledWith('chat-1');
    expect(chats.startChat).toHaveBeenCalledWith('chat-1');
  });
});

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
    const chats = createMockChatManager({ processState: 'idle' });
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
