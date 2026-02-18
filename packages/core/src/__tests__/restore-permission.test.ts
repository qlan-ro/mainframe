import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import type { Chat, ChatMessage, AdapterProcess, PermissionResponse, SpawnOptions } from '@mainframe/types';

// ── Minimal mock adapter ────────────────────────────────────────────

class MockAdapter extends BaseAdapter {
  id = 'mock';
  name = 'Mock';
  historyToReturn: ChatMessage[] = [];

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return '1.0';
  }
  async spawn(_options: SpawnOptions): Promise<AdapterProcess> {
    return { id: 'proc-1', adapterId: 'mock', chatId: '', pid: 0, status: 'ready', projectPath: '/tmp', model: 'test' };
  }
  async kill() {}
  async sendMessage() {}
  async respondToPermission(_process: AdapterProcess, _response: PermissionResponse) {}
  override async loadHistory(): Promise<ChatMessage[]> {
    return this.historyToReturn;
  }
}

// ── Minimal mock DB ─────────────────────────────────────────────────

function createMockDb(chat?: Record<string, unknown>, project?: Record<string, unknown>) {
  return {
    chats: {
      get: vi.fn().mockReturnValue(chat ?? null),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
    },
    projects: {
      get: vi.fn().mockReturnValue(project ?? null),
    },
    settings: {
      get: vi.fn().mockReturnValue(null),
    },
  };
}

// ── Message builders ────────────────────────────────────────────────

const chatId = 'test-chat';
let msgCounter = 0;

function msg(type: ChatMessage['type'], content: ChatMessage['content']): ChatMessage {
  return {
    id: `msg-${++msgCounter}`,
    chatId,
    type,
    content,
    timestamp: new Date().toISOString(),
    metadata: { source: 'history' },
  };
}

function userText(text: string) {
  return msg('user', [{ type: 'text', text }]);
}

function assistantText(text: string) {
  return msg('assistant', [{ type: 'text', text }]);
}

function assistantToolUse(toolName: string, toolUseId: string) {
  return msg('assistant', [
    { type: 'text', text: `Using ${toolName}` },
    { type: 'tool_use', id: toolUseId, name: toolName, input: {} },
  ]);
}

function toolResult(toolUseId: string, content: string, isError = false) {
  return msg('tool_result', [{ type: 'tool_result', toolUseId, content, isError }]);
}

// ── Tests ───────────────────────────────────────────────────────────

describe('restorePendingPermission (via getMessages + hasPendingPermission)', () => {
  let adapter: MockAdapter;
  let registry: AdapterRegistry;
  let manager: ChatManager;

  const testChat = {
    id: chatId,
    adapterId: 'mock',
    projectId: 'proj-1',
    claudeSessionId: 'session-1',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
  };

  const testProject = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

  beforeEach(() => {
    msgCounter = 0;
    adapter = new MockAdapter();
    registry = new AdapterRegistry();
    registry.register(adapter);
  });

  function setup(history: ChatMessage[]) {
    adapter.historyToReturn = history;
    const db = createMockDb(testChat, testProject);
    manager = new ChatManager(db as any, registry);
  }

  it('restores pending permission for unanswered tool_use', async () => {
    setup([
      userText('Do something'),
      assistantToolUse('Write', 'toolu_1'),
      // No tool_result — permission is pending
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(true);
  });

  it('does NOT restore permission when tool_use has a normal result', async () => {
    setup([userText('Do something'), assistantToolUse('Write', 'toolu_1'), toolResult('toolu_1', 'File written')]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });

  it('restores permission when tool_result is a permission failure', async () => {
    setup([
      userText('Do something'),
      assistantToolUse('Write', 'toolu_1'),
      toolResult('toolu_1', 'permission request failed to complete', true),
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(true);
  });

  it('does NOT restore when user text follows the failed permission', async () => {
    setup([
      userText('Do something'),
      assistantToolUse('Write', 'toolu_1'),
      toolResult('toolu_1', 'permission request failed', true),
      userText('Never mind, do something else'),
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });

  it('does NOT restore when assistant text-only follows failed permission', async () => {
    // CLI gave up on ExitPlanMode after repeated failures and wrote text.
    // With detached:false the CLI dies with the daemon, so this scenario
    // (CLI writing "gave up" text) should be rare. Don't show stale popup.
    setup([
      userText('Generate a plan'),
      assistantToolUse('ExitPlanMode', 'toolu_exit1'),
      toolResult('toolu_exit1', 'permission request failed', true),
      assistantToolUse('ExitPlanMode', 'toolu_exit2'),
      toolResult('toolu_exit2', 'permission request failed', true),
      assistantToolUse('ExitPlanMode', 'toolu_exit3'),
      toolResult('toolu_exit3', 'permission request failed', true),
      assistantText('Looks like ExitPlanMode is having connection issues.'),
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });

  it('does NOT restore when assistant thinking-only response follows failed permission', async () => {
    setup([
      userText('Do something'),
      assistantToolUse('Write', 'toolu_1'),
      toolResult('toolu_1', 'permission request failed', true),
      msg('assistant', [{ type: 'thinking', thinking: 'Let me reconsider...' }]),
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });

  it('DOES restore when assistant response WITH tool_use follows failed permission', async () => {
    // Assistant retried with a different tool — the new tool_use is pending
    setup([
      userText('Do something'),
      assistantToolUse('Write', 'toolu_1'),
      toolResult('toolu_1', 'permission request failed', true),
      assistantToolUse('Bash', 'toolu_2'),
      // No result for toolu_2 — it's pending
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(true);
  });

  it('restores the CORRECT tool for multiple consecutive tool_uses', async () => {
    setup([
      userText('Do something'),
      assistantToolUse('Write', 'toolu_1'),
      toolResult('toolu_1', 'File written'),
      assistantToolUse('Bash', 'toolu_2'),
      // No result for toolu_2
    ]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(true);
    const pending = await manager.getPendingPermission(chatId);
    expect(pending?.toolName).toBe('Bash');
    expect(pending?.toolUseId).toBe('toolu_2');
  });

  it('handles empty history', async () => {
    setup([]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });

  it('handles history with only user and assistant text', async () => {
    setup([userText('Hello'), assistantText('Hi there!')]);

    await manager.getMessages(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });
});

// ── respondToPermission: ExitPlanMode escalation before spawn ──────

describe('respondToPermission with no process (daemon restart scenario)', () => {
  let adapter: MockAdapter;
  let registry: AdapterRegistry;
  let manager: ChatManager;
  let db: ReturnType<typeof createMockDb>;
  let spawnOptions: SpawnOptions | null;
  let permissionResponses: PermissionResponse[];

  const testProject = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

  beforeEach(() => {
    msgCounter = 0;
    spawnOptions = null;
    permissionResponses = [];
    adapter = new MockAdapter();
    // Capture spawn options to verify the permission mode passed to the CLI
    const originalSpawn = adapter.spawn.bind(adapter);
    adapter.spawn = async (options: SpawnOptions) => {
      spawnOptions = options;
      return originalSpawn(options);
    };
    // Capture permission responses sent to the adapter after spawn
    adapter.respondToPermission = async (_process: AdapterProcess, response: PermissionResponse) => {
      permissionResponses.push(response);
    };
    registry = new AdapterRegistry();
    registry.register(adapter);
  });

  function setupWithPendingPermission(permissionMode: Chat['permissionMode']) {
    const testChat = {
      id: chatId,
      adapterId: 'mock',
      projectId: 'proj-1',
      claudeSessionId: 'session-1',
      status: 'active',
      permissionMode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
    };

    adapter.historyToReturn = [
      userText('Generate a plan'),
      assistantToolUse('ExitPlanMode', 'toolu_exit'),
      // No result — permission is pending
    ];

    db = createMockDb(testChat, testProject);
    manager = new ChatManager(db as any, registry);
  }

  it('escalates permission mode before spawning CLI when approving ExitPlanMode', async () => {
    setupWithPendingPermission('plan');

    // Load chat so activeChats is populated
    await manager.loadChat(chatId);
    expect(manager.hasPendingPermission(chatId)).toBe(true);

    // Approve ExitPlanMode with acceptEdits
    await manager.respondToPermission(chatId, {
      requestId: '',
      toolUseId: 'toolu_exit',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      executionMode: 'acceptEdits',
    });

    // The chat's permission mode should have been updated BEFORE spawn
    expect(db.chats.update).toHaveBeenCalledWith(chatId, expect.objectContaining({ permissionMode: 'acceptEdits' }));

    // The CLI should be spawned with the escalated mode
    expect(spawnOptions).not.toBeNull();
    expect(spawnOptions!.permissionMode).toBe('acceptEdits');

    // The permission response should be sent directly to the adapter
    expect(permissionResponses).toHaveLength(1);
    expect(permissionResponses[0].behavior).toBe('allow');
    expect(permissionResponses[0].toolName).toBe('ExitPlanMode');
  });

  it('escalates to default when no executionMode specified', async () => {
    setupWithPendingPermission('plan');
    await manager.loadChat(chatId);

    await manager.respondToPermission(chatId, {
      requestId: '',
      toolUseId: 'toolu_exit',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      // No executionMode
    });

    expect(spawnOptions).not.toBeNull();
    expect(spawnOptions!.permissionMode).toBe('default');
  });

  it('does NOT escalate when denying ExitPlanMode', async () => {
    setupWithPendingPermission('plan');
    await manager.loadChat(chatId);

    await manager.respondToPermission(chatId, {
      requestId: '',
      toolUseId: 'toolu_exit',
      toolName: 'ExitPlanMode',
      behavior: 'deny',
    });

    // Mode should stay as 'plan'
    expect(spawnOptions).not.toBeNull();
    expect(spawnOptions!.permissionMode).toBe('plan');
  });

  it('does NOT escalate for non-ExitPlanMode approvals', async () => {
    // Setup with Write pending instead of ExitPlanMode
    const testChat = {
      id: chatId,
      adapterId: 'mock',
      projectId: 'proj-1',
      claudeSessionId: 'session-1',
      status: 'active',
      permissionMode: 'plan' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
    };
    adapter.historyToReturn = [userText('Do something'), assistantToolUse('Write', 'toolu_write')];
    db = createMockDb(testChat, testProject);
    manager = new ChatManager(db as any, registry);

    await manager.loadChat(chatId);

    await manager.respondToPermission(chatId, {
      requestId: '',
      toolUseId: 'toolu_write',
      toolName: 'Write',
      behavior: 'allow',
    });

    // Mode should stay as 'plan'
    expect(spawnOptions).not.toBeNull();
    expect(spawnOptions!.permissionMode).toBe('plan');

    // The permission response should still be sent directly to the adapter
    expect(permissionResponses).toHaveLength(1);
    expect(permissionResponses[0].behavior).toBe('allow');
    expect(permissionResponses[0].toolName).toBe('Write');
  });

  it('clears pending permission after responding', async () => {
    setupWithPendingPermission('plan');
    await manager.loadChat(chatId);

    expect(manager.hasPendingPermission(chatId)).toBe(true);

    await manager.respondToPermission(chatId, {
      requestId: '',
      toolUseId: 'toolu_exit',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      executionMode: 'acceptEdits',
    });

    expect(manager.hasPendingPermission(chatId)).toBe(false);
  });
});

describe('respondToPermission clearContext ExitPlanMode', () => {
  let adapter: MockAdapter;
  let registry: AdapterRegistry;
  let manager: ChatManager;
  let db: ReturnType<typeof createMockDb>;

  const testProject = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

  beforeEach(() => {
    msgCounter = 0;
    adapter = new MockAdapter();
    registry = new AdapterRegistry();
    registry.register(adapter);
  });

  async function setupWithRunningProcess(history: ChatMessage[]) {
    const testChat = {
      id: chatId,
      adapterId: 'mock',
      projectId: 'proj-1',
      claudeSessionId: 'session-1',
      status: 'active',
      permissionMode: 'plan' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
    };

    adapter.historyToReturn = history;
    db = createMockDb(testChat, testProject);
    manager = new ChatManager(db as any, registry);
    await manager.loadChat(chatId);
    await manager.startChat(chatId);
  }

  it('persists recovered plan file from history when approving ExitPlanMode with clearContext', async () => {
    const respondSpy = vi.spyOn(adapter, 'respondToPermission');
    const killSpy = vi.spyOn(adapter, 'kill');
    const sendSpy = vi.spyOn(adapter, 'sendMessage');

    await setupWithRunningProcess([
      userText('Generate a plan'),
      toolResult('toolu_plan', 'Your plan has been saved to: /tmp/test/plan.md'),
      assistantToolUse('ExitPlanMode', 'toolu_exit'),
    ]);

    await manager.respondToPermission(chatId, {
      requestId: 'req-1',
      toolUseId: 'toolu_exit',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      clearContext: true,
      updatedInput: { plan: '# Plan\n1. Do it' },
    });

    expect(db.chats.addPlanFile).toHaveBeenCalledWith(chatId, '/tmp/test/plan.md');
    expect(respondSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ behavior: 'deny', toolName: 'ExitPlanMode' }),
    );
    expect(killSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Implement the following plan:'),
      undefined,
    );
  });

  it('does not persist a plan file when history does not contain a recoverable path', async () => {
    await setupWithRunningProcess([
      userText('Generate a plan'),
      assistantText('Here is the plan.'),
      assistantToolUse('ExitPlanMode', 'toolu_exit'),
    ]);

    await manager.respondToPermission(chatId, {
      requestId: 'req-2',
      toolUseId: 'toolu_exit',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      clearContext: true,
      updatedInput: { plan: '# Plan\n1. Do it' },
    });

    expect(db.chats.addPlanFile).not.toHaveBeenCalled();
  });
});
