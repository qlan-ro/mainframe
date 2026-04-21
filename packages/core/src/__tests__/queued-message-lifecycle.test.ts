import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { handleStdout } from '../plugins/builtin/claude/events.js';
import type { ClaudeSession, ClaudeSessionState } from '../plugins/builtin/claude/session.js';
import type { DaemonEvent, SessionSink } from '@qlan-ro/mainframe-types';

/**
 * Bug #116: Queued messages not clearing from composer.
 *
 * These tests specify the correct lifecycle semantics for queued messages
 * under stream-json mode with `--replay-user-messages`.
 */

function makeSink(
  activeChats: Map<string, any>,
  chatId: string,
  emitEvent: (event: DaemonEvent) => void,
  callbacks?: {
    onQueuedProcessed?: (chatId: string, uuid: string) => void;
    onQueuedCleared?: (chatId: string) => void;
  },
) {
  const db: any = {
    chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
    projects: { get: vi.fn() },
    settings: { get: vi.fn() },
  };
  const messages = new MessageCache();
  const permissions = new PermissionManager();
  const handler = new EventHandler(
    db,
    messages,
    permissions,
    (id) => activeChats.get(id),
    emitEvent,
    () => undefined,
    callbacks?.onQueuedProcessed,
    callbacks?.onQueuedCleared,
  );
  const sink: SessionSink = handler.buildSink(chatId, vi.fn().mockResolvedValue(undefined));
  return { sink, messages, handler, db };
}

function makeActiveChat(chatId: string): Map<string, any> {
  const map = new Map();
  map.set(chatId, {
    chat: {
      id: chatId,
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      processState: 'working',
    },
    session: { id: 'session-1', adapterId: 'claude' },
  });
  return map;
}

describe('Queued message cleanup — onQueuedProcessed via isReplay', () => {
  const chatId = 'chat-q2';
  let activeChats: Map<string, any>;
  let emitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    activeChats = makeActiveChat(chatId);
    emitEvent = vi.fn();
  });

  function makeSessionState(): ClaudeSessionState {
    return {
      chatId,
      buffer: '',
      child: null,
      status: 'ready',
      pid: 123,
      activeTasks: new Map(),
      interruptTimer: null,
      pendingCancelCallbacks: new Map(),
      pendingPrCreates: new Set(),
    };
  }

  it('isReplay=true triggers onQueuedProcessed and emits message.queued.processed', () => {
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink, messages } = makeSink(activeChats, chatId, emit);
    const queuedMsg = messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'queued B' }], {
      queued: true,
      uuid: 'uuid-B',
    });
    messages.append(chatId, queuedMsg);

    const session = { state: makeSessionState() } as unknown as ClaudeSession;
    const replayEvent =
      JSON.stringify({
        type: 'user',
        uuid: 'uuid-B',
        isReplay: true,
        message: { role: 'user', content: [] },
      }) + '\n';

    handleStdout(session, Buffer.from(replayEvent), sink);

    const processedEvents = emitEvent.mock.calls.filter((call) => call[0].type === 'message.queued.processed');
    expect(processedEvents).toHaveLength(1);
    expect(processedEvents[0][0].uuid).toBe('uuid-B');
    // metadata.queued is stripped from the cached message:
    expect(messages.get(chatId)![0]?.metadata?.queued).toBeUndefined();
  });

  it('onQueuedProcessed invokes the chat-manager callback so queuedRefs can be pruned', () => {
    const onQueuedProcessed = vi.fn();
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink, messages } = makeSink(activeChats, chatId, emit, { onQueuedProcessed });
    const queuedMsg = messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'queued B' }], {
      queued: true,
      uuid: 'uuid-B',
    });
    messages.append(chatId, queuedMsg);

    sink.onQueuedProcessed('uuid-B');

    expect(onQueuedProcessed).toHaveBeenCalledWith(chatId, 'uuid-B');
  });

  it('stream-json user events without isReplay do not trigger processed', () => {
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink } = makeSink(activeChats, chatId, emit);
    const session = { state: makeSessionState() } as unknown as ClaudeSession;
    const normalEvent =
      JSON.stringify({
        type: 'user',
        uuid: 'uuid-B',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }) + '\n';

    handleStdout(session, Buffer.from(normalEvent), sink);

    const processedEvents = emitEvent.mock.calls.filter((call) => call[0].type === 'message.queued.processed');
    expect(processedEvents).toHaveLength(0);
  });
});

describe('Queued message cleanup — onResult must NOT prematurely clear', () => {
  const chatId = 'chat-q';
  let activeChats: Map<string, any>;
  let emitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    activeChats = makeActiveChat(chatId);
    emitEvent = vi.fn();
  });

  it('does not strip metadata.queued from messages still waiting in the CLI queue', () => {
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink, messages } = makeSink(activeChats, chatId, emit);
    // Two queued messages, neither yet dequeued by the CLI
    messages.append(
      chatId,
      messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'B' }], { queued: true, uuid: 'uuid-B' }),
    );
    messages.append(
      chatId,
      messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'C' }], { queued: true, uuid: 'uuid-C' }),
    );

    // The current turn finishes (for an earlier, non-queued message)
    sink.onResult({ total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } });

    // Queued metadata must survive — per-uuid isReplay events will clear each
    // one as the CLI actually dequeues it.
    const msgs = messages.get(chatId)!;
    expect(msgs.find((m) => m.metadata?.uuid === 'uuid-B')?.metadata?.queued).toBe(true);
    expect(msgs.find((m) => m.metadata?.uuid === 'uuid-C')?.metadata?.queued).toBe(true);

    // And no bulk clear event leaks out.
    const clearEvents = emitEvent.mock.calls.filter((call) => call[0].type === 'message.queued.cleared');
    expect(clearEvents).toHaveLength(0);
  });
});

describe('ChatManager — queued refs access', () => {
  it('exposes getQueuedForChat returning only refs for that chat', async () => {
    const { ChatManager } = await import('../chat/chat-manager.js');
    const db: any = {
      chats: { get: vi.fn(), list: vi.fn(), update: vi.fn(), listAll: vi.fn().mockReturnValue([]) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    const adapters: any = { get: vi.fn(), list: vi.fn().mockReturnValue([]) };
    const manager = new ChatManager(db, adapters);
    const internal = manager as unknown as { queuedRefs: Map<string, any> };
    internal.queuedRefs.set('u1', { uuid: 'u1', chatId: 'A', messageId: 'mA', content: '', timestamp: '' });
    internal.queuedRefs.set('u2', { uuid: 'u2', chatId: 'A', messageId: 'mA2', content: '', timestamp: '' });
    internal.queuedRefs.set('u3', { uuid: 'u3', chatId: 'B', messageId: 'mB', content: '', timestamp: '' });

    const api = manager as unknown as { getQueuedForChat(id: string): unknown[] };
    expect(api.getQueuedForChat('A')).toHaveLength(2);
    expect(api.getQueuedForChat('B')).toHaveLength(1);
    expect(api.getQueuedForChat('ZZ')).toHaveLength(0);
  });
});

describe('Queued message cleanup — onExit clears queue on abnormal termination', () => {
  const chatId = 'chat-q3';
  let activeChats: Map<string, any>;
  let emitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    activeChats = makeActiveChat(chatId);
    emitEvent = vi.fn();
  });

  it('strips metadata.queued and emits message.queued.cleared when the CLI exits', () => {
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink, messages } = makeSink(activeChats, chatId, emit);
    messages.append(
      chatId,
      messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'B' }], { queued: true, uuid: 'uuid-B' }),
    );

    sink.onExit(1);

    const clearEvents = emitEvent.mock.calls.filter((call) => call[0].type === 'message.queued.cleared');
    expect(clearEvents).toHaveLength(1);
    expect(messages.get(chatId)![0]?.metadata?.queued).toBeUndefined();
  });

  it('invokes the chat-manager callback so queuedRefs can be wiped for the chat', () => {
    const onQueuedCleared = vi.fn();
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink, messages } = makeSink(activeChats, chatId, emit, { onQueuedCleared });
    messages.append(
      chatId,
      messages.createTransientMessage(chatId, 'user', [{ type: 'text', text: 'B' }], { queued: true, uuid: 'uuid-B' }),
    );

    sink.onExit(1);

    expect(onQueuedCleared).toHaveBeenCalledWith(chatId);
  });

  it('is a no-op (no event) when there are no queued messages', () => {
    const emit = emitEvent as unknown as (e: DaemonEvent) => void;
    const { sink } = makeSink(activeChats, chatId, emit);

    sink.onExit(0);

    const clearEvents = emitEvent.mock.calls.filter((call) => call[0].type === 'message.queued.cleared');
    expect(clearEvents).toHaveLength(0);
  });
});
