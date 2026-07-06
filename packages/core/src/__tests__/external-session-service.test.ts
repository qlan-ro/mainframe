import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../db/schema.js';
import { ExternalSessionService } from '../chat/external-session-service.js';
import type { Adapter, ExternalSession, ExternalSessionPage, DaemonEvent } from '@qlan-ro/mainframe-types';
import { AdapterRegistry } from '../adapters/index.js';
import { ChatsRepository } from '../db/chats.js';
import { ProjectsRepository } from '../db/projects.js';

function makeSession(sessionId: string, projectPath = '/test/project'): ExternalSession {
  return {
    sessionId,
    adapterId: 'claude',
    projectPath,
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };
}

function makePageResult(sessions: ExternalSession[], total?: number): ExternalSessionPage {
  return { sessions, total: total ?? sessions.length, nextOffset: null };
}

function createMockAdapter(page: ExternalSessionPage = { sessions: [], total: 0, nextOffset: null }): Adapter {
  return {
    id: 'claude',
    name: 'Claude',
    capabilities: { planMode: false },
    isInstalled: async () => true,
    getVersion: async () => '1.0',
    listModels: async () => [],
    createSession: vi.fn() as unknown as Adapter['createSession'],
    killAll: vi.fn(),
    listExternalSessions: vi.fn().mockResolvedValue(page),
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
    mockAdapter = createMockAdapter();

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

  describe('scanPage', () => {
    it('returns empty page for unknown project', async () => {
      const result = await service.scanPage('nonexistent', 0, 20);
      expect(result).toEqual({ sessions: [], total: 0, nextOffset: null });
    });

    it('returns sessions from adapter with adapterId stamped', async () => {
      const sessions = [makeSession('ext-1')];
      (mockAdapter.listExternalSessions as ReturnType<typeof vi.fn>).mockResolvedValue(makePageResult(sessions, 1));

      const result = await service.scanPage(projectId, 0, 20);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]!.sessionId).toBe('ext-1');
      expect(result.sessions[0]!.adapterId).toBe('claude');
      expect(result.total).toBe(1);
      expect(result.nextOffset).toBeNull();
    });

    it('passes prefixLimit (offset+limit) to adapter with offset 0', async () => {
      await service.scanPage(projectId, 10, 5);
      expect(mockAdapter.listExternalSessions).toHaveBeenCalledWith('/test/project', [], { offset: 0, limit: 15 });
    });

    it('passes exclude IDs to adapter with offset 0 and prefixLimit', async () => {
      const chat = chatsRepo.create(projectId, 'claude');
      chatsRepo.update(chat.id, { claudeSessionId: 'already-imported' });

      await service.scanPage(projectId, 0, 20);
      expect(mockAdapter.listExternalSessions).toHaveBeenCalledWith('/test/project', ['already-imported'], {
        offset: 0,
        limit: 20,
      });
    });

    it('returns empty page when adapter has no listExternalSessions', async () => {
      const adapterWithoutList: Adapter = {
        id: 'other',
        name: 'Other',
        capabilities: { planMode: false },
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
        const result = await serviceWithout.scanPage(projectId, 0, 20);
        expect(result).toEqual({ sessions: [], total: 0, nextOffset: null });
      } finally {
        serviceWithout.stopAll();
      }
    });

    it('scanPage over-fetches with prefixLimit (offset+limit) and stamps adapterId', async () => {
      const listSpy = vi.fn().mockResolvedValue({
        sessions: [{ sessionId: 's1', adapterId: 'x', projectPath: '/p', createdAt: 'a', modifiedAt: 'a' }],
        total: 5,
        nextOffset: null,
      });
      const adapters = { getAll: () => [{ id: 'claude', listExternalSessions: listSpy }] } as any;
      const db2 = {
        projects: { get: () => ({ id: 'proj', path: '/p' }) },
        chats: { getImportedSessionIds: () => [] },
      } as any;
      const svc = new ExternalSessionService(db2, adapters, vi.fn());

      const page = await svc.scanPage('proj', 2, 2);

      // With new semantics: over-fetch [0, offset+limit) = [0, 4); slice(2, 4) in implementation
      expect(listSpy).toHaveBeenCalledWith('/p', [], { offset: 0, limit: 4 });
      // Adapter returned 1 session total (adapter said total=5); after slice(2,4) → empty (only 1 item, index 0, sliced from 2)
      expect(page.total).toBe(5);
      expect(page.sessions).toHaveLength(0);
      expect(page.nextOffset).toBe(4); // 2+2 < 5
    });

    it('count-only (limit=0): returns sum of adapter totals, empty sessions, nextOffset null', async () => {
      const listSpy = vi.fn().mockResolvedValue({ sessions: [], total: 7, nextOffset: null });
      const adapters = { getAll: () => [{ id: 'claude', listExternalSessions: listSpy }] } as any;
      const db2 = {
        projects: { get: () => ({ id: 'proj', path: '/p' }) },
        chats: { getImportedSessionIds: () => [] },
      } as any;
      const svc = new ExternalSessionService(db2, adapters, vi.fn());

      const page = await svc.scanPage('proj', 0, 0);

      expect(listSpy).toHaveBeenCalledWith('/p', [], { offset: 0, limit: 0 });
      expect(page.total).toBe(7);
      expect(page.sessions).toHaveLength(0);
      expect(page.nextOffset).toBeNull();
    });

    it('merges and sorts sessions from two adapters by modifiedAt desc', async () => {
      const sessionA1: ExternalSession = {
        sessionId: 'a1',
        adapterId: 'claude',
        projectPath: '/p',
        createdAt: '2026-01-03T00:00:00Z',
        modifiedAt: '2026-01-03T00:00:00Z',
      };
      const sessionA2: ExternalSession = {
        sessionId: 'a2',
        adapterId: 'claude',
        projectPath: '/p',
        createdAt: '2026-01-01T00:00:00Z',
        modifiedAt: '2026-01-01T00:00:00Z',
      };
      const sessionB1: ExternalSession = {
        sessionId: 'b1',
        adapterId: 'codex',
        projectPath: '/p',
        createdAt: '2026-01-02T00:00:00Z',
        modifiedAt: '2026-01-02T00:00:00Z',
      };

      const spyA = vi.fn().mockResolvedValue({ sessions: [sessionA1, sessionA2], total: 2, nextOffset: null });
      const spyB = vi.fn().mockResolvedValue({ sessions: [sessionB1], total: 1, nextOffset: null });

      const adapters = {
        getAll: () => [
          { id: 'claude', listExternalSessions: spyA },
          { id: 'codex', listExternalSessions: spyB },
        ],
      } as any;
      const db2 = {
        projects: { get: () => ({ id: 'proj', path: '/p' }) },
        chats: { getImportedSessionIds: () => [] },
      } as any;
      const svc = new ExternalSessionService(db2, adapters, vi.fn());

      // Page 1: offset=0, limit=2 → prefixLimit=2, each adapter fetches [0,2); merge+sort→[a1,b1,a2]; slice(0,2)=[a1,b1]
      const page1 = await svc.scanPage('proj', 0, 2);
      expect(page1.total).toBe(3);
      expect(page1.sessions).toHaveLength(2);
      expect(page1.sessions[0]!.sessionId).toBe('a1');
      expect(page1.sessions[1]!.sessionId).toBe('b1');
      expect(page1.nextOffset).toBe(2); // 0+2 < 3

      // Page 2: offset=2, limit=2 → prefixLimit=4, each adapter fetches [0,4); merge+sort→[a1,b1,a2]; slice(2,4)=[a2]
      const page2 = await svc.scanPage('proj', 2, 2);
      expect(page2.total).toBe(3);
      expect(page2.sessions).toHaveLength(1);
      expect(page2.sessions[0]!.sessionId).toBe('a2');
      expect(page2.nextOffset).toBeNull(); // 2+2 >= 3
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
