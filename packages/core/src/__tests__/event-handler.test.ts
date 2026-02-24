import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { AdapterRegistry } from '../adapters/index.js';
import type { SessionSink } from '@mainframe/types';

function createRespondToPermission() {
  return vi.fn().mockResolvedValue(undefined);
}

describe('EventHandler token accumulation', () => {
  let db: any;
  let adapters: AdapterRegistry;
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
    adapters = new AdapterRegistry();
    messages = new MessageCache();
    permissions = new PermissionManager(db, adapters);
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
  let adapters: AdapterRegistry;
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
    adapters = new AdapterRegistry();
    messages = new MessageCache();
    permissions = new PermissionManager(db, adapters);
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
  let adapters: AdapterRegistry;
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
    adapters = new AdapterRegistry();
    msgCache = new MessageCache();
    permissions = new PermissionManager(db, adapters);
    emitEvent = vi.fn();
    activeChats = new Map();
    activeChats.set(chatId, {
      chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
      session: null,
    });
  });

  it('emits a system announcement for slash-command skill flows', () => {
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    // No preceding tool_result in cache → slash-command flow
    sink.onSkillFile({ path: '/home/user/.claude/skills/brainstorming/SKILL.md', displayName: 'brainstorming' });

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(1);
    const msg = systemEvents[0][0].message;
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Using skill: brainstorming' });
  });

  it('does not emit an announcement for autonomous Skill-tool flows', () => {
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    // Seed cache with a tool_result message starting with "Launching skill:"
    const toolResultMsg = msgCache.createTransientMessage(chatId, 'tool_result', [
      { type: 'tool_result', toolUseId: 'toolu_123', content: 'Launching skill: brainstorming', isError: false },
    ]);
    msgCache.append(chatId, toolResultMsg);

    sink.onSkillFile({ path: '/home/user/.claude/skills/brainstorming/SKILL.md', displayName: 'brainstorming' });

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(0);
  });

  it('derives display name from parent directory when file is SKILL.md', () => {
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onSkillFile({
      path: '/home/user/.claude/plugins/my-plugin/skills/my-skill/SKILL.md',
      displayName: 'my-skill',
    });

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(1);
    expect(systemEvents[0][0].message.content[0]).toMatchObject({ text: 'Using skill: my-skill' });
  });
});
