import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { AdapterRegistry } from '../adapters/index.js';
import type { DaemonEvent, SessionSink } from '@mainframe/types';

function createRespondToPermission() {
  return vi.fn().mockResolvedValue(undefined);
}

describe('EventHandler display event emission', () => {
  let db: any;
  let adapters: AdapterRegistry;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: DaemonEvent) => void>>;
  let activeChats: Map<string, any>;

  const chatId = 'chat-display';

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
  });

  function buildHandler(): EventHandler {
    return new EventHandler(
      db,
      messages,
      permissions,
      (id) => activeChats.get(id),
      emitEvent,
      () => undefined,
    );
  }

  function filterEvents(type: string): DaemonEvent[] {
    return emitEvent.mock.calls.map((call) => call[0] as DaemonEvent).filter((e) => e.type === type);
  }

  it('emits display.messages.set on first onMessage', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'text', text: 'hello' }]);

    const setEvents = filterEvents('display.messages.set');
    expect(setEvents).toHaveLength(1);
    const payload = setEvents[0] as Extract<DaemonEvent, { type: 'display.messages.set' }>;
    expect(payload.chatId).toBe(chatId);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]!.type).toBe('assistant');
  });

  it('emits display.message.added for second assistant message', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'text', text: 'first' }]);
    emitEvent.mockClear();

    // Insert a user message so grouping does not merge the two assistant turns
    const userMsg = messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'user input' }]);
    messages.append(chatId, userMsg);

    sink.onMessage([{ type: 'text', text: 'second' }]);

    const addedEvents = filterEvents('display.message.added');
    expect(addedEvents.length).toBeGreaterThanOrEqual(1);
    const added = addedEvents[addedEvents.length - 1] as Extract<DaemonEvent, { type: 'display.message.added' }>;
    expect(added.message.type).toBe('assistant');
  });

  it('emits display.message.updated when tool_result merges into existing turn', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onMessage([
      { type: 'text', text: 'thinking...' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/file.txt' } },
    ]);
    emitEvent.mockClear();

    sink.onToolResult([{ type: 'tool_result', toolUseId: 'tool-1', content: 'file contents here', isError: false }]);

    const updatedEvents = filterEvents('display.message.updated');
    expect(updatedEvents).toHaveLength(1);
    const updated = updatedEvents[0] as Extract<DaemonEvent, { type: 'display.message.updated' }>;
    expect(updated.chatId).toBe(chatId);
    expect(updated.message.type).toBe('assistant');
  });

  it('emits display events on onCompact', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onCompact();

    const setEvents = filterEvents('display.messages.set');
    expect(setEvents).toHaveLength(1);
    const payload = setEvents[0] as Extract<DaemonEvent, { type: 'display.messages.set' }>;
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]!.type).toBe('system');
  });

  it('emits display events on onResult error', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onResult({
      subtype: 'error_during_execution',
      is_error: true,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const setEvents = filterEvents('display.messages.set');
    expect(setEvents).toHaveLength(1);
    const payload = setEvents[0] as Extract<DaemonEvent, { type: 'display.messages.set' }>;
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]!.type).toBe('error');
  });

  it('still emits raw message.added alongside display events', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'text', text: 'hello' }]);

    const rawEvents = filterEvents('message.added');
    const displayEvents = filterEvents('display.messages.set');
    expect(rawEvents).toHaveLength(1);
    expect(displayEvents).toHaveLength(1);
  });

  it('consecutive onMessage calls for same turn emit display.message.updated', () => {
    const sink: SessionSink = buildHandler().buildSink(chatId, createRespondToPermission());

    sink.onMessage([{ type: 'text', text: 'part 1' }]);
    emitEvent.mockClear();
    sink.onMessage([{ type: 'text', text: 'part 2' }]);

    const updatedEvents = filterEvents('display.message.updated');
    expect(updatedEvents).toHaveLength(1);
    const updated = updatedEvents[0] as Extract<DaemonEvent, { type: 'display.message.updated' }>;
    expect(updated.message.type).toBe('assistant');
  });
});
