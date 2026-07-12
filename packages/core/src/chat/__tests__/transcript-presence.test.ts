import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import { ChatsRepository } from '../../db/chats.js';
import { ProjectsRepository } from '../../db/projects.js';
import { initializeSchema } from '../../db/schema.js';
import { reconcileTranscriptPresence, type TranscriptPresenceDeps } from '../transcript-presence.js';

describe('reconcileTranscriptPresence', () => {
  let chats: ChatsRepository;
  let projects: ProjectsRepository;
  let projectId: string;
  let events: DaemonEvent[];
  let synced: Array<{ chatId: string; partial: Partial<Chat> }>;
  let presence: boolean | null;

  function makeDeps(adapterHasPredicate = true): TranscriptPresenceDeps {
    const adapter = adapterHasPredicate ? { isTranscriptPresent: vi.fn(async () => presence) } : {};
    return {
      db: { chats, projects } as unknown as TranscriptPresenceDeps['db'],
      adapters: { get: () => adapter } as unknown as TranscriptPresenceDeps['adapters'],
      emitEvent: (e) => events.push(e),
      syncChatFields: (chatId, partial) => synced.push({ chatId, partial }),
    };
  }

  function makeChat(overrides: Partial<Chat> = {}): Chat {
    const chat = chats.create(projectId, 'claude');
    const updates: Partial<Chat> = { claudeSessionId: 'sess-1', ...overrides };
    chats.update(chat.id, updates);
    return chats.get(chat.id)!;
  }

  beforeEach(() => {
    const db = new Database(':memory:');
    initializeSchema(db);
    chats = new ChatsRepository(db);
    projects = new ProjectsRepository(db);
    projectId = projects.create('/project/p1').id;
    events = [];
    synced = [];
    presence = true;
  });

  it('sets the flag, persists it, syncs memory, and emits chat.updated when the transcript is gone', async () => {
    presence = false;
    const chat = makeChat();
    const result = await reconcileTranscriptPresence(makeDeps(), chat);

    expect(result).toBe(true);
    expect(chat.transcriptMissing).toBe(true);
    expect(chats.get(chat.id)?.transcriptMissing).toBe(true);
    expect(synced).toEqual([{ chatId: chat.id, partial: { transcriptMissing: true } }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'chat.updated', chat: { id: chat.id, transcriptMissing: true } });
  });

  it('clears the flag when the transcript reappears (self-healing)', async () => {
    presence = true;
    const chat = makeChat({ transcriptMissing: true });
    const result = await reconcileTranscriptPresence(makeDeps(), chat);

    expect(result).toBe(false);
    expect(chats.get(chat.id)?.transcriptMissing).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'chat.updated', chat: { id: chat.id, transcriptMissing: false } });
  });

  it('does not re-persist or re-emit when the state is unchanged (idempotent)', async () => {
    presence = false;
    const chat = makeChat({ transcriptMissing: true });
    const result = await reconcileTranscriptPresence(makeDeps(), chat);

    expect(result).toBe(true);
    expect(events).toHaveLength(0);
    expect(synced).toHaveLength(0);
  });

  it('skips chats with an active run (CLI owns the file mid-session)', async () => {
    presence = false;
    const chat = makeChat({ processState: 'working' });
    const result = await reconcileTranscriptPresence(makeDeps(), chat);

    expect(result).toBe(false);
    expect(chats.get(chat.id)?.transcriptMissing).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('treats a chat without a session id as new, and clears a stale flag on it', async () => {
    const chat = chats.create(projectId, 'claude');
    chats.update(chat.id, { transcriptMissing: true });
    const loaded = chats.get(chat.id)!;

    const result = await reconcileTranscriptPresence(makeDeps(), loaded);
    expect(result).toBe(false);
    expect(chats.get(chat.id)?.transcriptMissing).toBe(false);
  });

  it('skips adapters that do not implement the predicate', async () => {
    presence = false;
    const chat = makeChat();
    const result = await reconcileTranscriptPresence(makeDeps(false), chat);

    expect(result).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('skips when presence cannot be determined (predicate returns null)', async () => {
    presence = null;
    const chat = makeChat({ transcriptMissing: true });
    const result = await reconcileTranscriptPresence(makeDeps(), chat);

    expect(result).toBe(true);
    expect(chats.get(chat.id)?.transcriptMissing).toBe(true);
    expect(events).toHaveLength(0);
  });
});
