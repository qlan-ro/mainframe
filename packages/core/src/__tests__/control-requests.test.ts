import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import type { Chat, AdapterProcess, SpawnOptions } from '@mainframe/types';

// ── Helpers: capture stdin writes from ClaudeAdapter ────────────────

function createMockChildProcess(chatId: string) {
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
  return { child, written, chatId };
}

function injectMockProcess(adapter: ClaudeAdapter, processId: string, chatId: string) {
  const mock = createMockChildProcess(chatId);
  // Access private map — acceptable in tests
  (adapter as any).processes.set(processId, {
    id: processId,
    adapterId: 'claude',
    chatId,
    pid: mock.child.pid,
    status: 'ready',
    projectPath: '/tmp',
    model: 'test',
    child: mock.child,
    buffer: '',
  });
  return mock;
}

// ── ClaudeAdapter: setPermissionMode & setModel ─────────────────────

describe('ClaudeAdapter control requests', () => {
  let adapter: ClaudeAdapter;
  const processId = 'proc-1';
  const chatId = 'session-abc';
  const process: AdapterProcess = {
    id: processId,
    adapterId: 'claude',
    chatId,
    pid: 12345,
    status: 'ready',
    projectPath: '/tmp',
    model: 'test',
  };

  beforeEach(() => {
    adapter = new ClaudeAdapter();
  });

  it('setPermissionMode sends correct control_request payload', async () => {
    const mock = injectMockProcess(adapter, processId, chatId);

    await adapter.setPermissionMode(process, 'default');

    expect(mock.written).toHaveLength(1);
    const payload = JSON.parse(mock.written[0].trim());
    expect(payload.type).toBe('control_request');
    expect(payload.request_id).toBeTruthy();
    expect(payload.request).toEqual({
      subtype: 'set_permission_mode',
      mode: 'default',
    });
  });

  it('setPermissionMode maps yolo to bypassPermissions', async () => {
    const mock = injectMockProcess(adapter, processId, chatId);

    await adapter.setPermissionMode(process, 'yolo');

    const payload = JSON.parse(mock.written[0].trim());
    expect(payload.request.mode).toBe('bypassPermissions');
  });

  it('setPermissionMode passes through all other modes unchanged', async () => {
    const modes = ['default', 'plan', 'acceptEdits'];

    for (const mode of modes) {
      const mock = injectMockProcess(adapter, processId, chatId);

      await adapter.setPermissionMode(process, mode);

      const payload = JSON.parse(mock.written[0].trim());
      expect(payload.request.mode).toBe(mode);

      // Clean up for next iteration
      (adapter as any).processes.delete(processId);
    }
  });

  it('setModel sends correct control_request payload', async () => {
    const mock = injectMockProcess(adapter, processId, chatId);

    await adapter.setModel(process, 'claude-sonnet-4-5-20250929');

    expect(mock.written).toHaveLength(1);
    const payload = JSON.parse(mock.written[0].trim());
    expect(payload.type).toBe('control_request');
    expect(payload.request_id).toBeTruthy();
    expect(payload.request).toEqual({
      subtype: 'set_model',
      model: 'claude-sonnet-4-5-20250929',
    });
  });

  it('setPermissionMode throws for unknown process', async () => {
    await expect(adapter.setPermissionMode({ ...process, id: 'nonexistent' }, 'default')).rejects.toThrow(
      'Process nonexistent not found',
    );
  });

  it('setModel throws for unknown process', async () => {
    await expect(adapter.setModel({ ...process, id: 'nonexistent' }, 'claude-opus-4-6')).rejects.toThrow(
      'Process nonexistent not found',
    );
  });

  it('each control_request has a unique request_id', async () => {
    const mock = injectMockProcess(adapter, processId, chatId);

    await adapter.setPermissionMode(process, 'default');
    await adapter.setModel(process, 'claude-opus-4-6');

    expect(mock.written).toHaveLength(2);
    const id1 = JSON.parse(mock.written[0].trim()).request_id;
    const id2 = JSON.parse(mock.written[1].trim()).request_id;
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

describe('ChatManager.updateChatConfig — in-flight control requests', () => {
  let manager: ChatManager;
  let registry: AdapterRegistry;
  let claude: ClaudeAdapter;
  let db: ReturnType<typeof createMockDb>;
  let killSpy: ReturnType<typeof vi.fn<(process: AdapterProcess) => Promise<void>>>;
  let spawnCount: number;

  const chatId = 'test-chat';
  const processId = 'proc-1';
  const sessionId = 'session-abc';

  beforeEach(async () => {
    db = createMockDb({ claudeSessionId: sessionId });
    registry = new AdapterRegistry();
    claude = registry.get('claude') as ClaudeAdapter;

    // Track kills and spawns
    killSpy = vi.fn();
    spawnCount = 0;

    claude.spawn = async (options: SpawnOptions) => {
      spawnCount++;
      // Return a mock process instead of spawning real CLI
      return {
        id: processId,
        adapterId: 'claude',
        chatId: sessionId,
        pid: 99999,
        status: 'ready',
        projectPath: options.projectPath,
        model: options.model,
      };
    };
    claude.kill = killSpy;

    manager = new ChatManager(db as any, registry);

    // Create and start the chat so it has a running process
    await manager.createChat('proj-1', 'claude', 'claude-opus-4-6', 'default');
    await manager.startChat(chatId);
    spawnCount = 0; // reset after initial spawn

    // Inject a mock child process so setPermissionMode/setModel can write to stdin
    injectMockProcess(claude, processId, sessionId);
  });

  it('permission mode change uses control_request, no kill or restart', async () => {
    await manager.updateChatConfig(chatId, undefined, undefined, 'yolo');

    // Should NOT have killed the process
    expect(killSpy).not.toHaveBeenCalled();
    // Should NOT have spawned a new process
    expect(spawnCount).toBe(0);

    // Verify DB was updated
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
    const mock = (claude as any).processes.get(processId);
    const written: string[] = [];
    const originalWrite = mock.child.stdin.write.bind(mock.child.stdin);
    mock.child.stdin.write = (chunk: any, ...args: any[]) => {
      written.push(chunk.toString());
      return originalWrite(chunk, ...args);
    };

    await manager.updateChatConfig(chatId, undefined, undefined, 'yolo');

    // ChatManager passes 'yolo' to the adapter; the adapter maps it to 'bypassPermissions'
    const permPayload = written.find((w) => {
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
    // update should not be called since nothing changed
    expect(db.chats.update).not.toHaveBeenCalledWith(chatId, expect.anything());
  });
});
