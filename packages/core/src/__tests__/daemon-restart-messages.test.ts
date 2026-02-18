import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import type {
  ChatMessage,
  MessageContent,
  AdapterProcess,
  PermissionResponse,
  SpawnOptions,
  DaemonEvent,
} from '@mainframe/types';

// ── Mock Adapter ────────────────────────────────────────────────────

class MockAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Mock';
  emittedMessages: ChatMessage[] = [];

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return '1.0';
  }
  async spawn(_options: SpawnOptions): Promise<AdapterProcess> {
    return {
      id: 'proc-1',
      adapterId: 'claude',
      chatId: '',
      pid: 0,
      status: 'ready',
      projectPath: '/tmp',
      model: 'test',
    };
  }
  async kill() {}
  async sendMessage() {}
  async respondToPermission(_process: AdapterProcess, _response: PermissionResponse) {}

  override async loadHistory(): Promise<ChatMessage[]> {
    return this.emittedMessages;
  }

  /** Emit a message through the adapter event system AND record it for loadHistory. */
  emitTestMessage(processId: string, index: number): void {
    const content: MessageContent[] = [{ type: 'text', text: `Message ${index}` }];
    this.emit('message', processId, content);

    // Also record in the "persistent store" so loadHistory returns it after restart
    this.emittedMessages.push({
      id: `msg-${index}`,
      chatId: 'test-chat',
      type: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      metadata: { source: 'history' },
    });
  }
}

// ── Mock DB ─────────────────────────────────────────────────────────

const TEST_CHAT = {
  id: 'test-chat',
  adapterId: 'claude',
  projectId: 'proj-1',
  status: 'active',
  claudeSessionId: 'session-1',
  processState: 'working',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
};

const TEST_PROJECT = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

function createMockDb() {
  return {
    chats: {
      get: vi.fn().mockReturnValue(TEST_CHAT),
      create: vi.fn().mockReturnValue(TEST_CHAT),
      list: vi.fn().mockReturnValue([TEST_CHAT]),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
      getMentions: vi.fn().mockReturnValue([]),
      getModifiedFilesList: vi.fn().mockReturnValue([]),
      getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]),
      addModifiedFile: vi.fn().mockReturnValue(false),
    },
    projects: {
      get: vi.fn().mockReturnValue(TEST_PROJECT),
      list: vi.fn().mockReturnValue([TEST_PROJECT]),
      getByPath: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      remove: vi.fn(),
      updateLastOpened: vi.fn(),
    },
    settings: {
      get: vi.fn().mockReturnValue(null),
      getByCategory: vi.fn().mockReturnValue({}),
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function createServerStack(adapter: MockAdapter) {
  const db = createMockDb();
  const registry = new AdapterRegistry();
  // Replace the default Claude adapter with our mock
  (registry as any).adapters = new Map();
  registry.register(adapter);

  const chats = new ChatManager(db as any, registry);
  const app = createHttpServer(db as any, chats, registry);
  const httpServer = createServer(app);
  new WebSocketManager(httpServer, chats);

  return { httpServer, chats, db };
}

function startServer(server: Server, port = 0): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Force-close all active connections so server.close() doesn't hang
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForDisconnect(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on('close', () => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Test ─────────────────────────────────────────────────────────────

describe('message resilience across daemon restart', () => {
  let server1: Server | null = null;
  let server2: Server | null = null;
  let ws1: WebSocket | null = null;
  let ws2: WebSocket | null = null;

  afterEach(async () => {
    ws1?.close();
    ws2?.close();
    await Promise.all([
      server1?.listening ? stopServer(server1) : undefined,
      server2?.listening ? stopServer(server2) : undefined,
    ]);
  });

  it('client recovers all 10 messages after daemon restart', async () => {
    const adapter = new MockAdapter();
    const processId = 'proc-1';

    // ── Server 1: initial daemon ──────────────────────────────────
    const stack1 = createServerStack(adapter);
    server1 = stack1.httpServer;
    const port = await startServer(server1);

    // Connect WS client and subscribe
    ws1 = await connectWs(port);
    ws1.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);

    // Collect messages received via WS
    const liveMessages: DaemonEvent[] = [];
    ws1.on('message', (data) => {
      const event = JSON.parse(data.toString()) as DaemonEvent;
      if (event.type === 'message.added') liveMessages.push(event);
    });

    // Emit first 5 messages (100ms intervals — fast for tests)
    for (let i = 1; i <= 5; i++) {
      adapter.emitTestMessage(processId, i);
      await sleep(20);
    }

    // Wait for WS delivery
    await sleep(100);
    expect(liveMessages.length).toBe(5);

    // ── Daemon crash ──────────────────────────────────────────────
    ws1.close();
    await stopServer(server1);
    server1 = null;

    // Remaining 5 messages are "written to disk" by the adapter (but daemon is dead,
    // so no WS broadcast). We push them directly into emittedMessages.
    for (let i = 6; i <= 10; i++) {
      adapter.emittedMessages.push({
        id: `msg-${i}`,
        chatId: 'test-chat',
        type: 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }],
        timestamp: new Date().toISOString(),
        metadata: { source: 'history' },
      });
    }

    // ── Server 2: restarted daemon ────────────────────────────────
    const stack2 = createServerStack(adapter);
    server2 = stack2.httpServer;
    const port2 = await startServer(server2);

    // Reconnect WS client
    ws2 = await connectWs(port2);
    ws2.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    // Wait for loadChat → loadHistory to complete
    await sleep(200);

    // Fetch all messages via REST
    const res = await fetch(`http://127.0.0.1:${port2}/api/chats/test-chat/messages`);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(10);

    // Verify messages are in order
    for (let i = 0; i < 10; i++) {
      const content = json.data[i].content[0];
      expect(content.text).toBe(`Message ${i + 1}`);
    }
  }, 15_000);
});
