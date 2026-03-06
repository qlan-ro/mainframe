import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../db/schema.js';
import { ExternalSessionService } from '../chat/external-session-service.js';
import type { Adapter, ExternalSession, DaemonEvent } from '@mainframe/types';
import { AdapterRegistry } from '../adapters/index.js';
import { ChatsRepository } from '../db/chats.js';
import { ProjectsRepository } from '../db/projects.js';

function createMockAdapter(sessions: ExternalSession[] = []): Adapter {
  return {
    id: 'claude',
    name: 'Claude',
    isInstalled: async () => true,
    getVersion: async () => '1.0',
    listModels: async () => [],
    createSession: vi.fn() as unknown as Adapter['createSession'],
    killAll: vi.fn(),
    listExternalSessions: vi.fn().mockResolvedValue(sessions),
  };
}

describe('ExternalSessionService', () => {
  let db: Database.Database;
  let chatsRepo: ChatsRepository;
  let projectsRepo: ProjectsRepository;
  let projectId: string;
  let emittedEvents: DaemonEvent[];
  let service: ExternalSessionService;
  let mockAdapter: Adapter;
  let adapterRegistry: AdapterRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    chatsRepo = new ChatsRepository(db);
    projectsRepo = new ProjectsRepository(db);

    const project = projectsRepo.create('/test/project', 'Test');
    projectId = project.id;

    emittedEvents = [];
    mockAdapter = createMockAdapter([]);

    adapterRegistry = new AdapterRegistry();
    adapterRegistry.register(mockAdapter);

    const mockDb = {
      projects: projectsRepo,
      chats: chatsRepo,
    };

    service = new ExternalSessionService(mockDb as any, adapterRegistry, (event) => {
      emittedEvents.push(event);
    });
  });

  afterEach(() => {
    service.stopAll();
    db.close();
  });

  describe('scan', () => {
    it('returns empty array for unknown project', async () => {
      const result = await service.scan('nonexistent');
      expect(result).toEqual([]);
    });

    it('returns sessions from adapter', async () => {
      const sessions: ExternalSession[] = [
        {
          sessionId: 'ext-1',
          adapterId: 'claude',
          projectPath: '/test',
          createdAt: '2026-01-01T00:00:00Z',
          modifiedAt: '2026-01-01T00:00:00Z',
        },
      ];
      (mockAdapter.listExternalSessions as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);

      const result = await service.scan(projectId);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('ext-1');
    });

    it('passes exclude IDs to adapter', async () => {
      const chat = chatsRepo.create(projectId, 'claude');
      chatsRepo.update(chat.id, { claudeSessionId: 'already-imported' });

      await service.scan(projectId);
      expect(mockAdapter.listExternalSessions).toHaveBeenCalledWith('/test/project', ['already-imported']);
    });

    it('returns empty array when adapter has no listExternalSessions', async () => {
      const adapterWithoutList: Adapter = {
        id: 'other',
        name: 'Other',
        isInstalled: async () => true,
        getVersion: async () => '1.0',
        listModels: async () => [],
        createSession: vi.fn() as unknown as Adapter['createSession'],
        killAll: vi.fn(),
        // no listExternalSessions
      };

      const registryWithout = new AdapterRegistry();
      registryWithout.register(adapterWithoutList);

      const mockDb = { projects: projectsRepo, chats: chatsRepo };
      const serviceWithout = new ExternalSessionService(mockDb as any, registryWithout, vi.fn());

      try {
        const result = await serviceWithout.scan(projectId);
        expect(result).toEqual([]);
      } finally {
        serviceWithout.stopAll();
      }
    });
  });

  describe('importSession', () => {
    it('creates a new chat with claudeSessionId', async () => {
      const chat = await service.importSession(projectId, 'ext-session-1', 'claude');

      expect(chat.claudeSessionId).toBe('ext-session-1');
      expect(chat.projectId).toBe(projectId);
      expect(chat.adapterId).toBe('claude');
    });

    it('emits chat.created event', async () => {
      await service.importSession(projectId, 'ext-session-2', 'claude');

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.type).toBe('chat.created');
    });

    it('returns existing chat on duplicate import', async () => {
      const first = await service.importSession(projectId, 'ext-dup', 'claude');
      const second = await service.importSession(projectId, 'ext-dup', 'claude');

      expect(second.id).toBe(first.id);
      // Only one chat.created event (first import only)
      const chatCreatedEvents = emittedEvents.filter((e) => e.type === 'chat.created');
      expect(chatCreatedEvents).toHaveLength(1);
    });

    it('persists claudeSessionId to database', async () => {
      const chat = await service.importSession(projectId, 'ext-persist', 'claude');
      const fromDb = chatsRepo.get(chat.id);

      expect(fromDb).not.toBeNull();
      expect(fromDb!.claudeSessionId).toBe('ext-persist');
    });
  });
});
