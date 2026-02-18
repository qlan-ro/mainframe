import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler, type ChatLookup } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { AdapterRegistry } from '../adapters/index.js';

function createMockLookup(): ChatLookup & { activeChats: Map<string, any> } {
  const activeChats = new Map<string, any>();
  const processToChat = new Map<string, string>();
  return {
    activeChats,
    getActiveChat: (chatId) => activeChats.get(chatId),
    getChatIdForProcess: (processId) => processToChat.get(processId),
    deleteProcessMapping: (processId) => processToChat.delete(processId),
  };
}

describe('EventHandler token accumulation', () => {
  let lookup: ReturnType<typeof createMockLookup>;
  let db: any;
  let adapters: AdapterRegistry;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let claude: ClaudeAdapter;

  beforeEach(() => {
    lookup = createMockLookup();
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    claude = new ClaudeAdapter();
    adapters = new AdapterRegistry();
    (adapters as any).adapters = new Map([['claude', claude]]);
    messages = new MessageCache();
    permissions = new PermissionManager(db, adapters);
    emitEvent = vi.fn();

    new EventHandler(lookup, db, adapters, messages, permissions, emitEvent).setup();
  });

  it('accumulates tokens across multiple result events', () => {
    const processId = 'proc-1';
    const chatId = 'chat-1';
    lookup.activeChats.set(chatId, {
      chat: {
        id: chatId,
        totalCost: 0,
        totalTokensInput: 100,
        totalTokensOutput: 50,
        processState: 'working',
      },
      process: { id: processId },
    });
    const processToChat = new Map([['proc-1', 'chat-1']]);
    (lookup as any).getChatIdForProcess = (pid: string) => processToChat.get(pid);

    // Emit first result
    claude.emit('result', processId, {
      cost: 0.01,
      tokensInput: 200,
      tokensOutput: 80,
      durationMs: 1000,
    });

    const chat = lookup.activeChats.get(chatId)!.chat;
    expect(chat.totalTokensInput).toBe(300); // 100 + 200
    expect(chat.totalTokensOutput).toBe(130); // 50 + 80
    expect(chat.totalCost).toBeCloseTo(0.01);

    // Emit second result
    claude.emit('result', processId, {
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

describe('EventHandler skill_file announcement', () => {
  let lookup: ReturnType<typeof createMockLookup>;
  let db: any;
  let adapters: AdapterRegistry;
  let msgCache: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let claude: ClaudeAdapter;
  const processId = 'proc-skill';
  const chatId = 'chat-skill';

  beforeEach(() => {
    lookup = createMockLookup();
    db = {
      chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    claude = new ClaudeAdapter();
    adapters = new AdapterRegistry();
    (adapters as any).adapters = new Map([['claude', claude]]);
    msgCache = new MessageCache();
    permissions = new PermissionManager(db, adapters);
    emitEvent = vi.fn();

    const processToChat = new Map([[processId, chatId]]);
    (lookup as any).getChatIdForProcess = (pid: string) => processToChat.get(pid);
    lookup.activeChats.set(chatId, {
      chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
      process: { id: processId },
    });

    new EventHandler(lookup, db, adapters, msgCache, permissions, emitEvent).setup();
  });

  it('emits a system announcement for slash-command skill flows', () => {
    // No preceding tool_result in cache → slash-command flow
    claude.emit('skill_file', processId, '/home/user/.claude/skills/brainstorming/SKILL.md');

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(1);
    const msg = systemEvents[0][0].message;
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Using skill: brainstorming' });
  });

  it('does not emit an announcement for autonomous Skill-tool flows', () => {
    // Seed cache with a tool_result message starting with "Launching skill:"
    const toolResultMsg = msgCache.createTransientMessage(chatId, 'tool_result', [
      { type: 'tool_result', toolUseId: 'toolu_123', content: 'Launching skill: brainstorming', isError: false },
    ]);
    msgCache.append(chatId, toolResultMsg);

    claude.emit('skill_file', processId, '/home/user/.claude/skills/brainstorming/SKILL.md');

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(0);
  });

  it('derives display name from parent directory when file is SKILL.md', () => {
    claude.emit('skill_file', processId, '/home/user/.claude/plugins/my-plugin/skills/my-skill/SKILL.md');

    const systemEvents = emitEvent.mock.calls.filter(
      (call) => call[0].type === 'message.added' && call[0].message?.type === 'system',
    );

    expect(systemEvents).toHaveLength(1);
    expect(systemEvents[0][0].message.content[0]).toMatchObject({ text: 'Using skill: my-skill' });
  });
});
