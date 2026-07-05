import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventHandler } from '../event-handler.js';
import { MessageCache } from '../message-cache.js';
import { PermissionManager } from '../permission-manager.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

function createRespondToPermission() {
  return vi.fn().mockResolvedValue(undefined);
}

describe('EventHandler onResult — turn duration metadata', () => {
  let db: any;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-timing';

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a transient system message carrying metadata.turnDurationMs, measured from turnStartedAt', () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    activeChats.set(chatId, {
      chat: {
        id: chatId,
        totalCost: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        processState: 'working',
      },
      session: null,
      turnStartedAt: startedAt,
    });

    vi.advanceTimersByTime(1500);

    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onResult({ total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } });

    const systemTiming = emitEvent.mock.calls.find(
      ([e]: [any]) => e.type === 'message.added' && e.message?.type === 'system' && e.message?.metadata?.turnDurationMs,
    );
    expect(systemTiming).toBeDefined();
    expect(systemTiming![0].message.metadata.turnDurationMs).toBe(1500);
  });

  it('does not emit a turn-timing message when turnStartedAt was never stamped', () => {
    activeChats.set(chatId, {
      chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
      session: null,
    });

    const handler = new EventHandler(db, messages, permissions, (id) => activeChats.get(id), emitEvent);
    const sink: SessionSink = handler.buildSink(chatId, createRespondToPermission());

    sink.onResult({ total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } });

    const systemTiming = emitEvent.mock.calls.find(
      ([e]: [any]) => e.type === 'message.added' && e.message?.type === 'system' && e.message?.metadata?.turnDurationMs,
    );
    expect(systemTiming).toBeUndefined();
  });
});
