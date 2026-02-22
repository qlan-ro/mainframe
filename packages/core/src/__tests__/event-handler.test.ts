import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { AdapterRegistry } from '../adapters/index.js';
import type { AdapterSession } from '@mainframe/types';

function createMockSession(): AdapterSession & EventEmitter {
  const session = new EventEmitter() as EventEmitter & AdapterSession;
  (session as any).id = 'session-1';
  (session as any).adapterId = 'claude';
  (session as any).projectPath = '/tmp';
  (session as any).isSpawned = true;
  (session as any).respondToPermission = vi.fn().mockResolvedValue(undefined);
  return session;
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

    const session = createMockSession();
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    handler.attachSession(chatId, session);

    session.emit('result', {
      cost: 0.01,
      tokensInput: 200,
      tokensOutput: 80,
      durationMs: 1000,
    });

    const chat = activeChats.get(chatId)!.chat;
    expect(chat.totalTokensInput).toBe(300); // 100 + 200
    expect(chat.totalTokensOutput).toBe(130); // 50 + 80
    expect(chat.totalCost).toBeCloseTo(0.01);

    session.emit('result', {
      cost: 0.02,
      tokensInput: 150,
      tokensOutput: 60,
      durationMs: 800,
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
      session: null,
    });

    const session = createMockSession();
    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    handler.attachSession(chatId, session);

    session.emit('message', [{ type: 'text', text: 'hello' }]);

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
    const session = createMockSession();
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    handler.attachSession(chatId, session);

    // No preceding tool_result in cache → slash-command flow
    session.emit('skill_file', '/home/user/.claude/skills/brainstorming/SKILL.md');

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(1);
    const msg = systemEvents[0][0].message;
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Using skill: brainstorming' });
  });

  it('does not emit an announcement for autonomous Skill-tool flows', () => {
    const session = createMockSession();
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    handler.attachSession(chatId, session);

    // Seed cache with a tool_result message starting with "Launching skill:"
    const toolResultMsg = msgCache.createTransientMessage(chatId, 'tool_result', [
      { type: 'tool_result', toolUseId: 'toolu_123', content: 'Launching skill: brainstorming', isError: false },
    ]);
    msgCache.append(chatId, toolResultMsg);

    session.emit('skill_file', '/home/user/.claude/skills/brainstorming/SKILL.md');

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(0);
  });

  it('derives display name from parent directory when file is SKILL.md', () => {
    const session = createMockSession();
    const handler = new EventHandler(db, msgCache, permissions, (id) => activeChats.get(id), emitEvent);
    handler.attachSession(chatId, session);

    session.emit('skill_file', '/home/user/.claude/plugins/my-plugin/skills/my-skill/SKILL.md');

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(1);
    expect(systemEvents[0][0].message.content[0]).toMatchObject({ text: 'Using skill: my-skill' });
  });
});
