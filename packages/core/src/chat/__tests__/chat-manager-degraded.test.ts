import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, DaemonEvent } from '@qlan-ro/mainframe-types';
import { ChatsRepository } from '../../db/chats.js';
import { ProjectsRepository } from '../../db/projects.js';
import { initializeSchema } from '../../db/schema.js';
import { ChatManager } from '../chat-manager.js';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';

const HISTORY_MESSAGE: ChatMessage = {
  id: 'm1',
  chatId: 'sess-1',
  type: 'assistant',
  content: [{ type: 'text', text: 'hello from history' }],
  timestamp: '2026-07-08T00:00:00.000Z',
};

describe('ChatManager — degraded transcript handling', () => {
  let chats: ChatsRepository;
  let projects: ProjectsRepository;
  let events: DaemonEvent[];
  let mgr: ChatManager;
  let transcriptPresent: boolean;
  let history: ChatMessage[];
  let projectId: string;
  let chatId: string;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initializeSchema(sqlite);
    chats = new ChatsRepository(sqlite);
    projects = new ProjectsRepository(sqlite);
    events = [];
    transcriptPresent = true;
    history = [];

    const adapter = {
      isTranscriptPresent: vi.fn(async () => transcriptPresent),
      createSession: vi.fn(() => ({ loadHistory: vi.fn(async () => history) })),
    };
    const db: any = { chats, projects, settings: { get: vi.fn() } };
    const adapters: any = { get: vi.fn(() => adapter), getAll: vi.fn(() => []), list: vi.fn(() => []) };
    mgr = new ChatManager(db, adapters, new BackgroundTaskTracker(), undefined, (e) => events.push(e));

    projectId = projects.create('/project/degraded').id;
    const chat = chats.create(projectId, 'claude');
    chatId = chat.id;
    chats.update(chatId, { claudeSessionId: 'sess-1' });
  });

  it('getDisplayMessages reports transcriptMissing:true, persists the flag, and emits chat.updated', async () => {
    transcriptPresent = false;
    const result = await mgr.getDisplayMessages(chatId);

    expect(result.messages).toEqual([]);
    expect(result.transcriptMissing).toBe(true);
    expect(chats.get(chatId)?.transcriptMissing).toBe(true);
    expect(events.some((e) => e.type === 'chat.updated' && e.chat.transcriptMissing === true)).toBe(true);
  });

  it('getDisplayMessages returns history with transcriptMissing:false and self-heals a stale flag', async () => {
    chats.update(chatId, { transcriptMissing: true });
    transcriptPresent = true;
    history = [HISTORY_MESSAGE];

    const result = await mgr.getDisplayMessages(chatId);

    expect(result.transcriptMissing).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(chats.get(chatId)?.transcriptMissing).toBe(false);
  });

  it('sendMessage with the flag set clears the dead session identity and spawns fresh', async () => {
    chats.update(chatId, {
      transcriptMissing: true,
      sessionFilePath: '/home/u/.claude/projects/x/sess-1.jsonl',
    });

    const session = {
      isSpawned: true,
      supportsReplayAck: true,
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const startChat = vi.fn().mockImplementation(async () => {
      (mgr as any).activeChats.set(chatId, { chat: chats.get(chatId), session });
    });
    (mgr as any).lifecycle = {
      waitForInterrupt: vi.fn().mockResolvedValue(undefined),
      startChat,
      doGenerateTitle: vi.fn().mockResolvedValue(undefined),
      getLoadingChats: () => new Map(),
    };

    await mgr.sendMessage(chatId, 'continue after transcript loss');

    const row = chats.get(chatId);
    expect(row?.claudeSessionId).toBeNull();
    expect(row?.sessionFilePath).toBeNull();
    expect(row?.transcriptMissing).toBe(false);
    expect(startChat).toHaveBeenCalledWith(chatId);
    expect(session.sendMessage).toHaveBeenCalledTimes(1);
  });
});
