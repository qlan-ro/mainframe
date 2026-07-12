import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { ChatsRepository } from '../../db/chats.js';
import { ProjectsRepository } from '../../db/projects.js';
import { initializeSchema } from '../../db/schema.js';
import { ExternalSessionService } from '../external-session-service.js';

describe('ExternalSessionService.sweepTranscriptPresence', () => {
  let chats: ChatsRepository;
  let projects: ProjectsRepository;
  let projectId: string;
  let reconcile: ReturnType<typeof vi.fn<(chat: Chat) => Promise<boolean>>>;
  let service: ExternalSessionService;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initializeSchema(sqlite);
    chats = new ChatsRepository(sqlite);
    projects = new ProjectsRepository(sqlite);
    projectId = projects.create('/project/sweep').id;
    reconcile = vi.fn().mockResolvedValue(false);
    const db: any = { chats, projects, settings: { get: vi.fn() } };
    const adapters: any = { getAll: vi.fn(() => []) };
    service = new ExternalSessionService(db, adapters, () => {}, reconcile);
  });

  it('reconciles every non-archived chat with a CLI session id', async () => {
    const withSession = chats.create(projectId, 'claude');
    chats.update(withSession.id, { claudeSessionId: 'sess-a' });
    const draft = chats.create(projectId, 'claude'); // no session id — skipped
    const archived = chats.create(projectId, 'claude');
    chats.update(archived.id, { claudeSessionId: 'sess-b', status: 'archived' });

    await service.sweepTranscriptPresence(projectId);

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0]).toMatchObject({ id: withSession.id });
    expect(reconcile.mock.calls.every(([chat]) => chat.id !== draft.id && chat.id !== archived.id)).toBe(true);
  });

  it('is a no-op when no reconcile callback was provided', async () => {
    const db: any = { chats, projects, settings: { get: vi.fn() } };
    const bare = new ExternalSessionService(db, { getAll: () => [] } as any, () => {});
    await expect(bare.sweepTranscriptPresence(projectId)).resolves.toBeUndefined();
  });
});
