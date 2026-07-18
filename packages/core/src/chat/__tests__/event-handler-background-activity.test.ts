import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler } from '../event-handler.js';
import { MessageCache } from '../message-cache.js';
import { PermissionManager } from '../permission-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

const chatId = 'chat-bg';

describe('EventHandler — background activity lifecycle', () => {
  let db: any;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn<(event: any) => void>>;
  let activeChats: Map<string, any>;
  let tracker: BackgroundTaskTracker;

  function makeSink(): SessionSink {
    const handler = new EventHandler(
      db,
      messages,
      permissions,
      (id) => activeChats.get(id),
      emitEvent,
      () => undefined,
      () => {},
      () => {},
      () => [],
      () => {},
      tracker,
    );
    return handler.buildSink(chatId, vi.fn().mockResolvedValue(undefined));
  }

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
    tracker = new BackgroundTaskTracker();
  });

  describe('onExit clears the live background set', () => {
    it('stops every running task when the CLI process ends', () => {
      activeChats.set(chatId, {
        chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
        session: null,
      });
      tracker.start(
        chatId,
        { id: 'a-1', kind: 'agent', toolName: 'Bash', toolUseId: 't1', command: '', description: 'agent' },
        '/p/a-1',
      );
      tracker.start(
        chatId,
        { id: 'b-1', kind: 'bash', toolName: 'Bash', toolUseId: 't2', command: 'dev', description: '' },
        '/p/b-1',
      );

      makeSink().onExit(0);

      expect(tracker.listLive(chatId)).toEqual([]);
      expect(tracker.get(chatId, 'a-1')!.status).toBe('stopped');
      expect(tracker.get(chatId, 'b-1')!.status).toBe('stopped');
    });

    it('does not touch other chats', () => {
      activeChats.set(chatId, {
        chat: { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
        session: null,
      });
      tracker.start(
        'other-chat',
        { id: 'x-1', kind: 'bash', toolName: 'Bash', toolUseId: 't3', command: 'c', description: '' },
        '/p/x-1',
      );

      makeSink().onExit(0);

      expect(tracker.listLive('other-chat')).toHaveLength(1);
    });
  });

  describe('drain-turn re-entry on onMessage', () => {
    it('flips a non-working processState back to working and emits chat.updated', () => {
      const chat = { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'idle' };
      activeChats.set(chatId, { chat, session: null });

      makeSink().onMessage([{ type: 'text', text: 'drain-turn summary' }]);

      expect(chat.processState).toBe('working');
      expect(db.chats.update).toHaveBeenCalledWith(chatId, { processState: 'working' });
      const updated = emitEvent.mock.calls.find(([e]: [any]) => e.type === 'chat.updated');
      expect(updated).toBeDefined();
      expect(updated![0].chat.processState).toBe('working');
    });

    it('does not emit chat.updated when the turn is already working', () => {
      const chat = { id: chatId, totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' };
      activeChats.set(chatId, { chat, session: null });

      makeSink().onMessage([{ type: 'text', text: 'mid-turn message' }]);

      const updated = emitEvent.mock.calls.find(([e]: [any]) => e.type === 'chat.updated');
      expect(updated).toBeUndefined();
      expect(db.chats.update).not.toHaveBeenCalledWith(chatId, { processState: 'working' });
    });
  });
});
