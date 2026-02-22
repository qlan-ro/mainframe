import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../plugins/builtin/claude/adapter.js';
import { BaseSession } from '../adapters/base-session.js';
import type {
  Chat,
  AdapterProcess,
  AdapterSession,
  SessionOptions,
  SessionSpawnOptions,
  ChatMessage,
} from '@mainframe/types';

// ── Helpers: capture stdin writes from ClaudeSession ────────────────

function createMockChildProcess(_chatId: string) {
  const written: string[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk.toString());
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 12345,
    killed: false,
    kill: vi.fn(),
  });
  return { child, written };
}

/**
 * Creates a ClaudeSession via adapter.createSession() and injects a mock
 * child process so that setPermissionMode / setModel can write to stdin.
 */
function injectMockChild(adapter: ClaudeAdapter, chatId: string) {
  const mock = createMockChildProcess(chatId);
  const session = adapter.createSession({ projectPath: '/tmp', chatId }) as any;
  // Inject mock child — state.child being non-null makes isSpawned true
  session.state.child = mock.child;
  session.state.pid = mock.child.pid;
  session.state.status = 'ready';
  return { session, written: mock.written };
}

// ── ClaudeAdapter: setPermissionMode & setModel ─────────────────────

describe('ClaudeAdapter control requests', () => {
  let adapter: ClaudeAdapter;
  const chatId = 'session-abc';

  beforeEach(() => {
    adapter = new ClaudeAdapter();
  });

  it('setPermissionMode sends correct control_request payload', async () => {
    const { session, written } = injectMockChild(adapter, chatId);

    await session.setPermissionMode('default');

    expect(written).toHaveLength(1);
    const payload = JSON.parse(written[0]!.trim());
    expect(payload.type).toBe('control_request');
    expect(payload.request_id).toBeTruthy();
    expect(payload.request).toEqual({
      subtype: 'set_permission_mode',
      mode: 'default',
    });
  });

  it('setPermissionMode maps yolo to bypassPermissions', async () => {
    const { session, written } = injectMockChild(adapter, chatId);

    await session.setPermissionMode('yolo');

    const payload = JSON.parse(written[0]!.trim());
    expect(payload.request.mode).toBe('bypassPermissions');
  });

  it('setPermissionMode passes through all other modes unchanged', async () => {
    const modes = ['default', 'plan', 'acceptEdits'];

    for (const mode of modes) {
      const { session, written } = injectMockChild(adapter, chatId);

      await session.setPermissionMode(mode);

      const payload = JSON.parse(written[0]!.trim());
      expect(payload.request.mode).toBe(mode);
    }
  });

  it('setModel sends correct control_request payload', async () => {
    const { session, written } = injectMockChild(adapter, chatId);

    await session.setModel('claude-sonnet-4-5-20250929');

    expect(written).toHaveLength(1);
    const payload = JSON.parse(written[0]!.trim());
    expect(payload.type).toBe('control_request');
    expect(payload.request_id).toBeTruthy();
    expect(payload.request).toEqual({
      subtype: 'set_model',
      model: 'claude-sonnet-4-5-20250929',
    });
  });

  it('setPermissionMode throws when session not spawned', async () => {
    const session = adapter.createSession({ projectPath: '/tmp', chatId }) as any;
    await expect(session.setPermissionMode('default')).rejects.toThrow('not spawned');
  });

  it('setModel throws when session not spawned', async () => {
    const session = adapter.createSession({ projectPath: '/tmp', chatId }) as any;
    await expect(session.setModel('claude-opus-4-6')).rejects.toThrow('not spawned');
  });

  it('each control_request has a unique request_id', async () => {
    const { session, written } = injectMockChild(adapter, chatId);

    await session.setPermissionMode('default');
    await session.setModel('claude-opus-4-6');

    expect(written).toHaveLength(2);
    const id1 = JSON.parse(written[0]!.trim()).request_id;
    const id2 = JSON.parse(written[1]!.trim()).request_id;
    expect(id1).not.toBe(id2);
  });
});

// ── ChatManager: updateChatConfig in-flight (no restart) ────────────

function createMockDb(chat?: Partial<Chat>) {
  const defaultChat: Chat = {
    id: 'test-chat',
    projectId: 'proj-1',
    adapterId: 'claude',
    model: 'claude-opus-4-6',
    permissionMode: 'default',
    status: 'active',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    processState: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(chat ?? {}),
  };
  return {
    chats: {
      get: vi.fn().mockReturnValue(defaultChat),
      create: vi.fn().mockReturnValue(defaultChat),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
      getMentions: vi.fn().mockReturnValue([]),
      getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]),
    },
    projects: {
      get: vi.fn().mockReturnValue({ id: 'proj-1', path: '/tmp/project' }),
    },
    settings: {
      get: vi.fn().mockReturnValue(null),
    },
  };
}

/**
 * A mock session that captures setPermissionMode/setModel writes into `written`
 * and delegates spawn/kill counts to callbacks.
 */
class MockClaudeSession extends BaseSession {
  readonly id: string;
  readonly adapterId = 'claude';
  readonly projectPath: string;
  readonly written: string[] = [];
  private _isSpawned = false;

  constructor(
    options: SessionOptions,
    private callbacks: { onSpawn: () => void; onKill: () => void },
  ) {
    super();
    this.id = `mock-${Math.random().toString(36).slice(2)}`;
    this.projectPath = options.projectPath;
  }

  get isSpawned(): boolean {
    return this._isSpawned;
  }

  async spawn(_options?: SessionSpawnOptions): Promise<AdapterProcess> {
    this._isSpawned = true;
    this.callbacks.onSpawn();
    return {
      id: 'proc-1',
      adapterId: 'claude',
      chatId: '',
      pid: 99999,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async kill(): Promise<void> {
    this._isSpawned = false;
    this.callbacks.onKill();
  }

  getProcessInfo(): AdapterProcess | null {
    return this._isSpawned
      ? { id: 'proc-1', adapterId: 'claude', chatId: '', pid: 99999, status: 'ready', projectPath: this.projectPath }
      : null;
  }

  override async setPermissionMode(mode: string): Promise<void> {
    if (!this._isSpawned) throw new Error(`Session ${this.id} not spawned`);
    const cliMode = mode === 'yolo' ? 'bypassPermissions' : mode;
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_permission_mode', mode: cliMode },
    };
    this.written.push(JSON.stringify(payload) + '\n');
  }

  override async setModel(model: string): Promise<void> {
    if (!this._isSpawned) throw new Error(`Session ${this.id} not spawned`);
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_model', model },
    };
    this.written.push(JSON.stringify(payload) + '\n');
  }

  override async sendMessage(): Promise<void> {}
  override async loadHistory(): Promise<ChatMessage[]> {
    return [];
  }
}

describe('ChatManager.updateChatConfig — in-flight control requests', () => {
  let manager: ChatManager;
  let registry: AdapterRegistry;
  let claude: ClaudeAdapter;
  let db: ReturnType<typeof createMockDb>;
  let killSpy: ReturnType<typeof vi.fn>;
  let spawnCount: number;
  let currentMockSession: MockClaudeSession | null;

  const chatId = 'test-chat';
  const sessionId = 'session-abc';

  beforeEach(async () => {
    db = createMockDb({ claudeSessionId: sessionId });
    registry = new AdapterRegistry();
    registry.register(new ClaudeAdapter());
    claude = registry.get('claude') as ClaudeAdapter;

    killSpy = vi.fn();
    spawnCount = 0;
    currentMockSession = null;

    // Override createSession to return our mock session
    claude.createSession = (options: SessionOptions): AdapterSession => {
      const session = new MockClaudeSession(options, {
        onSpawn: () => spawnCount++,
        onKill: killSpy,
      });
      currentMockSession = session;
      return session;
    };

    manager = new ChatManager(db as any, registry);

    await manager.createChat('proj-1', 'claude', 'claude-opus-4-6', 'default');
    await manager.startChat(chatId);
    spawnCount = 0; // reset after initial spawn
  });

  it('permission mode change uses control_request, no kill or restart', async () => {
    await manager.updateChatConfig(chatId, undefined, undefined, 'yolo');

    expect(killSpy).not.toHaveBeenCalled();
    expect(spawnCount).toBe(0);
    expect(db.chats.update).toHaveBeenCalledWith(chatId, { permissionMode: 'yolo' });
  });

  it('model change uses control_request, no kill or restart', async () => {
    await manager.updateChatConfig(chatId, undefined, 'claude-sonnet-4-5-20250929');

    expect(killSpy).not.toHaveBeenCalled();
    expect(spawnCount).toBe(0);
    expect(db.chats.update).toHaveBeenCalledWith(chatId, { model: 'claude-sonnet-4-5-20250929' });
  });

  it('model + mode change both use control_requests, no restart', async () => {
    await manager.updateChatConfig(chatId, undefined, 'claude-haiku-4-5-20251001', 'acceptEdits');

    expect(killSpy).not.toHaveBeenCalled();
    expect(spawnCount).toBe(0);
    expect(db.chats.update).toHaveBeenCalledWith(chatId, {
      model: 'claude-haiku-4-5-20251001',
      permissionMode: 'acceptEdits',
    });
  });

  it('yolo mode is mapped to bypassPermissions by the adapter', async () => {
    await manager.updateChatConfig(chatId, undefined, undefined, 'yolo');

    // currentMockSession.written has the payload written by setPermissionMode
    const permPayload = currentMockSession!.written.find((w) => {
      try {
        const p = JSON.parse(w.trim());
        return p.request?.subtype === 'set_permission_mode';
      } catch {
        return false;
      }
    });

    expect(permPayload).toBeTruthy();
    const parsed = JSON.parse(permPayload!.trim());
    expect(parsed.request.mode).toBe('bypassPermissions');
  });

  it('emits chat.updated event on in-flight config change', async () => {
    const events: any[] = [];
    manager.on('event', (e) => events.push(e));

    await manager.updateChatConfig(chatId, undefined, 'claude-sonnet-4-5-20250929', 'plan');

    const chatUpdated = events.find((e) => e.type === 'chat.updated');
    expect(chatUpdated).toBeTruthy();
    expect(chatUpdated.chat.model).toBe('claude-sonnet-4-5-20250929');
    expect(chatUpdated.chat.permissionMode).toBe('plan');
  });

  it('no-op when nothing changed', async () => {
    await manager.updateChatConfig(chatId, undefined, 'claude-opus-4-6', 'default');

    expect(killSpy).not.toHaveBeenCalled();
    expect(spawnCount).toBe(0);
    expect(db.chats.update).not.toHaveBeenCalledWith(chatId, expect.anything());
  });
});
