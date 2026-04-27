import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

function createRespondToPermission() {
  return vi.fn().mockResolvedValue(undefined);
}

describe('EventHandler token accumulation', () => {
  let db: any;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-1';

  beforeEach(() => {
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    messages = new MessageCache();
    permissions = new PermissionManager();
    emitEvent = vi.fn();
    activeChats = new Map();
  });

  it('accumulates tokens across multiple result events', () => {
    activeChats.set(chatId, {
      chat: {
        id: chatId,
        totalCost: 0,
        totalTokensInput: 100,
        totalTokensOutput: 50,
        processState: 'working',
      },
      session: null,
    });

    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onResult({
      total_cost_usd: 0.01,
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    const chat = activeChats.get(chatId)!.chat;
    expect(chat.totalTokensInput).toBe(300); // 100 + 200
    expect(chat.totalTokensOutput).toBe(130); // 50 + 80
    expect(chat.totalCost).toBeCloseTo(0.01);

    sink.onResult({
      total_cost_usd: 0.02,
      usage: { input_tokens: 150, output_tokens: 60 },
    });

    expect(chat.totalTokensInput).toBe(450); // 300 + 150
    expect(chat.totalTokensOutput).toBe(190); // 130 + 60
    expect(chat.totalCost).toBeCloseTo(0.03);
  });
});

describe('EventHandler adapterId stamping', () => {
  let db: any;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-1';

  beforeEach(() => {
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    messages = new MessageCache();
    permissions = new PermissionManager();
    emitEvent = vi.fn();
    activeChats = new Map();
  });

  it('stamps adapterId on emitted assistant messages', () => {
    activeChats.set(chatId, {
      chat: {
        id: chatId,
        adapterId: 'claude',
        totalCost: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        processState: 'working',
      },
      session: { id: 'session-1', adapterId: 'claude' },
    });

    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'text', text: 'hello' }]);

    const emitted = emitEvent.mock.calls.find(([e]: [any]) => e.type === 'message.added');
    expect(emitted).toBeDefined();
    expect(emitted![0].message.metadata?.adapterId).toBe('claude');
  });
});

describe('EventHandler skill_file announcement', () => {
  let db: any;
  let msgCache: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-skill';

  beforeEach(() => {
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    msgCache = new MessageCache();
    permissions = new PermissionManager();
    emitEvent = vi.fn();
    activeChats = new Map();
    activeChats.set(chatId, {
      chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
      session: null,
    });
  });

  it('does not emit any system announcement — SkillLoadedCard covers both flows', () => {
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    // Slash-command flow: no preceding tool_result in cache
    sink.onSkillFile({ path: '/home/user/.claude/skills/brainstorming/SKILL.md', displayName: 'brainstorming' });

    // Autonomous Skill-tool flow: preceding tool_result with "Launching skill:"
    const toolResultMsg = msgCache.createTransientMessage(chatId, 'tool_result', [
      { type: 'tool_result', toolUseId: 'toolu_123', content: 'Launching skill: other', isError: false },
    ]);
    msgCache.append(chatId, toolResultMsg);
    sink.onSkillFile({ path: '/home/user/.claude/skills/other/SKILL.md', displayName: 'other' });

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(0);
  });
});

describe('EventHandler context.updated timing', () => {
  let db: any;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-ctx';

  beforeEach(() => {
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    messages = new MessageCache();
    permissions = new PermissionManager();
    emitEvent = vi.fn();
    activeChats = new Map();
    activeChats.set(chatId, {
      chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
      session: { id: 'session-1', adapterId: 'claude' },
    });
  });

  it('does not emit context.updated on assistant message with tool_use', () => {
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/foo/bar.ts' } }]);

    const ctxEvents = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'context.updated');
    expect(ctxEvents).toHaveLength(0);
  });

  it('emits context.updated with filePaths on tool_result for Write/Edit', () => {
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    // Step 1: assistant sends tool_use
    sink.onMessage([
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Edit',
        input: { file_path: '/foo/bar.ts', old_string: 'a', new_string: 'b' },
      },
      { type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/foo/baz.ts', content: 'new file' } },
    ]);

    // Step 2: tool results arrive
    sink.onToolResult([{ type: 'tool_result', toolUseId: 'toolu_1', content: 'ok', isError: false }]);

    const ctxEvents = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'context.updated');
    expect(ctxEvents).toHaveLength(1);
    expect(ctxEvents[0][0].filePaths).toEqual(['/foo/bar.ts']);

    emitEvent.mockClear();

    sink.onToolResult([{ type: 'tool_result', toolUseId: 'toolu_2', content: 'ok', isError: false }]);

    const ctxEvents2 = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'context.updated');
    expect(ctxEvents2).toHaveLength(1);
    expect(ctxEvents2[0][0].filePaths).toEqual(['/foo/baz.ts']);
  });

  it('does not emit context.updated for non-file tool_results', () => {
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    // assistant sends a Bash tool_use
    sink.onMessage([{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls' } }]);

    sink.onToolResult([{ type: 'tool_result', toolUseId: 'toolu_bash', content: 'file1\nfile2', isError: false }]);

    const ctxEvents = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'context.updated');
    expect(ctxEvents).toHaveLength(0);
  });

  it('emits context.updated (without filePaths) when a subagent tool result completes', () => {
    const subagentCategories = {
      subagent: new Set(['Task', 'Agent']),
      explore: new Set<string>(),
      hidden: new Set<string>(),
      progress: new Set<string>(),
    };
    const handler = new EventHandler(
      db,
      messages,
      permissions,
      (id) => activeChats.get(id),
      emitEvent,
      () => subagentCategories,
    );
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'tool_use', id: 'toolu_task', name: 'Task', input: { prompt: 'do work' } }]);

    sink.onToolResult([{ type: 'tool_result', toolUseId: 'toolu_task', content: 'done', isError: false }]);

    const ctxEvents = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'context.updated');
    expect(ctxEvents).toHaveLength(1);
    // No filePaths — the frontend will load from disk to get subagent changes
    expect(ctxEvents[0]![0].filePaths).toBeUndefined();
    expect(ctxEvents[0]![0].chatId).toBe(chatId);
  });

  it('does not emit duplicate context.updated when subagent tool also matches file tool', () => {
    // Edge case: if somehow a tool is both a file tool and subagent, only one event
    const subagentCategories = {
      subagent: new Set(['Task']),
      explore: new Set<string>(),
      hidden: new Set<string>(),
      progress: new Set<string>(),
    };
    const handler = new EventHandler(
      db,
      messages,
      permissions,
      (id) => activeChats.get(id),
      emitEvent,
      () => subagentCategories,
    );
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'tool_use', id: 'toolu_task', name: 'Task', input: { prompt: 'do work' } }]);
    emitEvent.mockClear();

    sink.onToolResult([{ type: 'tool_result', toolUseId: 'toolu_task', content: 'done', isError: false }]);

    const ctxEvents = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'context.updated');
    expect(ctxEvents).toHaveLength(1);
  });
});

describe('EventHandler onSkillLoaded', () => {
  let db: any;
  let msgCache: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-skill-loaded';

  beforeEach(() => {
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    msgCache = new MessageCache();
    permissions = new PermissionManager();
    emitEvent = vi.fn();
    activeChats = new Map();
    activeChats.set(chatId, {
      chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
      session: null,
    });
  });

  it('emits message.added with skill_loaded content block', () => {
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, () => Promise.resolve());

    sink.onSkillLoaded({
      skillName: 'brainstorming',
      path: '/home/user/.claude/skills/brainstorming/SKILL.md',
      content: '# brainstorming\n\nThink broadly.',
    });

    const addedEvents = emitEvent.mock.calls.filter(([e]: [any]) => e.type === 'message.added');
    expect(addedEvents).toHaveLength(1);
    const msg = addedEvents[0]![0].message;
    expect(msg.type).toBe('system');
    expect(msg.content[0]).toMatchObject({
      type: 'skill_loaded',
      skillName: 'brainstorming',
      path: '/home/user/.claude/skills/brainstorming/SKILL.md',
      content: '# brainstorming\n\nThink broadly.',
    });
  });
});

describe('EventHandler onPermission — yolo no longer auto-approves', () => {
  let db: any;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;
  let respondToPermission: ReturnType<typeof createRespondToPermission>;

  const chatId = 'chat-yolo';

  beforeEach(() => {
    db = {
      chats: {
        update: vi.fn(),
        get: vi.fn(),
        addPlanFile: vi.fn().mockReturnValue(false),
        addSkillFile: vi.fn().mockReturnValue(false),
      },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    messages = new MessageCache();
    permissions = new PermissionManager();
    emitEvent = vi.fn();
    respondToPermission = createRespondToPermission();
    activeChats = new Map();
    activeChats.set(chatId, {
      chat: {
        id: chatId,
        permissionMode: 'yolo',
        totalCost: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        processState: 'working',
      },
      session: { id: 'session-1', adapterId: 'claude' },
    });
  });

  it('enqueues permissions normally in yolo mode without calling respondToPermission', () => {
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, respondToPermission);

    sink.onPermission({ requestId: 'req-1', toolName: 'Bash', toolUseId: 'tu-1', input: {}, suggestions: [] });

    expect(respondToPermission).not.toHaveBeenCalled();
    expect(permissions.hasPending(chatId)).toBe(true);
    expect(permissions.getPending(chatId)?.requestId).toBe('req-1');

    const permissionEvent = emitEvent.mock.calls.find(([e]: [any]) => e.type === 'permission.requested');
    expect(permissionEvent).toBeDefined();
    expect(permissionEvent![0].request.toolName).toBe('Bash');
  });

  it('enqueues AskUserQuestion in yolo mode without auto-approving', () => {
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, respondToPermission);

    sink.onPermission({
      requestId: 'req-ask',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-ask',
      input: { questions: [] },
      suggestions: [],
    });

    expect(respondToPermission).not.toHaveBeenCalled();
    expect(permissions.hasPending(chatId)).toBe(true);
  });
});
