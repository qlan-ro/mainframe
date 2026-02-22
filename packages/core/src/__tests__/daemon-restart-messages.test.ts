import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { MockBaseAdapter } from './helpers/mock-adapter.js';
import { MockBaseSession } from './helpers/mock-session.js';
import type { ChatMessage, MessageContent, AdapterSession, SessionOptions, DaemonEvent } from '@mainframe/types';

// ── Mock Session ─────────────────────────────────────────────────────

class MockSession extends MockBaseSession {
  constructor(private adapter: MockAdapter) {
    super('proc-1', adapter.id, '/tmp');
  }

  /** loadHistory delegates to the adapter's persistent store. */
  override async loadHistory(): Promise<ChatMessage[]> {
    return this.adapter.emittedMessages;
  }
}

// ── Mock Adapter ─────────────────────────────────────────────────────

class MockAdapter extends MockBaseAdapter {
  override id = 'claude';
  override name = 'Mock';
  emittedMessages: ChatMessage[] = [];
  currentSession: MockSession | null = null;

  override createSession(_options: SessionOptions): AdapterSession {
    this.currentSession = new MockSession(this);
    return this.currentSession;
  }

  /** Emit a message through the session sink AND record it for loadHistory. */
  emitTestMessage(_processId: string, index: number): void {
    const content: MessageContent[] = [{ type: 'text', text: `Message ${index}` }];

    // Simulate on the running session (if any)
    this.currentSession?.simulateMessage(content);

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
  (registry as any).adapters = new Map();
  registry.register(adapter);

  const wsRef: { current: WebSocketManager | null } = { current: null };
  const chats = new ChatManager(db as any, registry, undefined, (event) => wsRef.current?.broadcastEvent(event));
  const app = createHttpServer(db as any, chats, registry);
  const httpServer = createServer(app);
  wsRef.current = new WebSocketManager(httpServer, chats);

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
      adapter.emitTestMessage('proc-1', i);
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
