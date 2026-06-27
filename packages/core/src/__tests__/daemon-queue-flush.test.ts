import { BackgroundTaskTracker } from '../background-tasks/tracker.js';
import { describe, it, expect, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

/**
 * Task A3: Flush the next held queued message on run-end.
 *
 * Verifies:
 *  1. EventHandler-level: flushNextQueued=true → processState:'working';
 *                         flushNextQueued=false → processState:'idle'.
 *  2. ChatManager-level: flushNextQueued pops the head item, calls
 *     session.sendMessage once with the head's outgoingContent, emits
 *     message.queued.processed, leaves 1 item in the queue, returns true.
 *     Empty queue → false, no sendMessage call.
 */

function makeSinkWithFlush(chatId: string, emit: (e: DaemonEvent) => void, flushNextQueued: (id: string) => boolean) {
  const db: any = {
    chats: { update: vi.fn(), get: vi.fn(), addSkillFile: vi.fn().mockReturnValue(false) },
    projects: { get: vi.fn() },
    settings: { get: vi.fn() },
  };
  const messages = new MessageCache();
  const activeChats = new Map([
    [
      chatId,
      {
        chat: {
          id: chatId,
          totalCost: 0,
          totalTokensInput: 0,
          totalTokensOutput: 0,
          processState: 'working',
        },
        session: { id: 's1', adapterId: 'claude' },
      },
    ],
  ]);
  const handler = new EventHandler(
    db,
    messages,
    new PermissionManager(),
    (id: string) => activeChats.get(id) as never,
    emit,
    () => undefined,
    () => {},
    () => {},
    () => [],
    flushNextQueued,
  );
  const sink = handler.buildSink(chatId, vi.fn().mockResolvedValue(undefined));
  return { sink, db };
}

describe('run-end flush — EventHandler (A3)', () => {
  it('flushNextQueued returns true → processState stays working', () => {
    const emit = vi.fn() as unknown as (e: DaemonEvent) => void;
    const { sink, db } = makeSinkWithFlush('c1', emit, () => true);

    sink.onResult({ total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } });

    expect(db.chats.update).toHaveBeenCalledWith('c1', expect.objectContaining({ processState: 'working' }));
  });

  it('flushNextQueued returns false → processState becomes idle', () => {
    const emit = vi.fn() as unknown as (e: DaemonEvent) => void;
    const { sink, db } = makeSinkWithFlush('c1', emit, () => false);

    sink.onResult({ total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } });

    expect(db.chats.update).toHaveBeenCalledWith('c1', expect.objectContaining({ processState: 'idle' }));
  });

  it('snapshot emitted after the flush call', () => {
    const emitCalls: DaemonEvent[] = [];
    const emit = (e: DaemonEvent) => emitCalls.push(e);
    let flushCalled = false;
    const flush = (id: string) => {
      flushCalled = true;
      return false;
    };
    const { sink } = makeSinkWithFlush('c2', emit, flush);

    sink.onResult({ total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } });

    expect(flushCalled).toBe(true);
    const snapshotIdx = emitCalls.findIndex((e) => e.type === 'message.queued.snapshot');
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
  });
});

describe('run-end flush — ChatManager.flushNextQueued (A3)', () => {
  async function makeManager() {
    const { ChatManager } = await import('../chat/chat-manager.js');
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const db: any = {
      chats: { get: vi.fn(), list: vi.fn(), update: vi.fn(), listAll: vi.fn().mockReturnValue([]) },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    const adapters: any = { get: vi.fn(), list: vi.fn().mockReturnValue([]) };
    const emittedEvents: DaemonEvent[] = [];
    const manager = new ChatManager(db, adapters, new BackgroundTaskTracker(), undefined, (e) => emittedEvents.push(e));

    const internal = manager as unknown as {
      activeChats: Map<string, any>;
      chatQueues: Map<string, any[]>;
      flushNextQueued(chatId: string): boolean;
    };

    const chatId = 'flush-test';

    // Install a fake active session with a sendMessage spy
    internal.activeChats.set(chatId, {
      chat: {
        id: chatId,
        totalCost: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        processState: 'working',
      },
      session: { id: 'sess-1', adapterId: 'claude', sendMessage },
    });

    return { manager, internal, chatId, sendMessage, emittedEvents };
  }

  it('pops the head item, calls sendMessage once with outgoingContent, returns true', async () => {
    const { internal, chatId, sendMessage } = await makeManager();

    internal.chatQueues.set(chatId, [
      { messageId: 'm1', uuid: 'u1', content: 'first', outgoingContent: 'first-out', timestamp: '' },
      { messageId: 'm2', uuid: 'u2', content: 'second', outgoingContent: 'second-out', timestamp: '' },
    ]);

    const result = internal.flushNextQueued(chatId);

    expect(result).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('first-out', undefined, undefined);
    expect(internal.chatQueues.get(chatId)).toHaveLength(1);
    expect(internal.chatQueues.get(chatId)![0]!.uuid).toBe('u2');
  });

  it('deletes the chatQueues entry when the last item is flushed', async () => {
    const { internal, chatId, sendMessage } = await makeManager();

    internal.chatQueues.set(chatId, [
      { messageId: 'm1', uuid: 'u1', content: 'only', outgoingContent: 'only-out', timestamp: '' },
    ]);

    const result = internal.flushNextQueued(chatId);

    expect(result).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(internal.chatQueues.has(chatId)).toBe(false);
  });

  it('emits message.queued.processed for the flushed item', async () => {
    const { internal, chatId, emittedEvents } = await makeManager();

    internal.chatQueues.set(chatId, [
      { messageId: 'm1', uuid: 'flush-uuid', content: 'x', outgoingContent: 'x-out', timestamp: '' },
    ]);

    internal.flushNextQueued(chatId);

    const processed = emittedEvents.filter((e) => e.type === 'message.queued.processed');
    expect(processed).toHaveLength(1);
    expect((processed[0] as any).uuid).toBe('flush-uuid');
  });

  it('returns false and does not call sendMessage when the queue is empty', async () => {
    const { internal, chatId, sendMessage } = await makeManager();

    const result = internal.flushNextQueued(chatId);

    expect(result).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns false when there is no active session', async () => {
    const { internal, chatId, sendMessage } = await makeManager();

    internal.chatQueues.set(chatId, [
      { messageId: 'm1', uuid: 'u1', content: 'x', outgoingContent: 'x', timestamp: '' },
    ]);
    internal.activeChats.delete(chatId);

    const result = internal.flushNextQueued(chatId);

    expect(result).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
