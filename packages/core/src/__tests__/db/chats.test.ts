import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../db/schema.js';
import { ProjectsRepository } from '../../db/projects.js';
import { ChatsRepository } from '../../db/chats.js';

describe('ChatsRepository', () => {
  let db: Database.Database;
  let chats: ChatsRepository;
  let projects: ProjectsRepository;
  let projectId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    chats = new ChatsRepository(db);
    projects = new ProjectsRepository(db);

    // Create a project for foreign key references
    const project = projects.create('/home/user/test-project', 'Test Project');
    projectId = project.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a chat and returns it', () => {
      const chat = chats.create(projectId, 'claude');

      expect(chat.id).toBeDefined();
      expect(chat.adapterId).toBe('claude');
      expect(chat.projectId).toBe(projectId);
      expect(chat.status).toBe('active');
      expect(chat.totalCost).toBe(0);
      expect(chat.totalTokensInput).toBe(0);
      expect(chat.totalTokensOutput).toBe(0);
      expect(chat.createdAt).toBeDefined();
      expect(chat.updatedAt).toBeDefined();
    });

    it('creates a chat with optional model and permissionMode', () => {
      const chat = chats.create(projectId, 'claude', 'claude-3-opus', 'yolo');

      expect(chat.model).toBe('claude-3-opus');
      expect(chat.permissionMode).toBe('yolo');
    });

    it('sets model and permissionMode to undefined when not provided', () => {
      const chat = chats.create(projectId, 'claude');

      expect(chat.model).toBeUndefined();
      expect(chat.permissionMode).toBeUndefined();
    });
  });

  describe('get', () => {
    it('returns a chat by id', () => {
      const created = chats.create(projectId, 'claude', 'claude-3-opus');
      const fetched = chats.get(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.adapterId).toBe('claude');
      expect(fetched!.projectId).toBe(projectId);
      expect(fetched!.model).toBe('claude-3-opus');
    });

    it('returns null for a missing id', () => {
      const result = chats.get('nonexistent-id');
      expect(result).toBeNull();
    });

    it('parses mentions as empty array by default', () => {
      const created = chats.create(projectId, 'claude');
      const fetched = chats.get(created.id);

      expect(fetched!.mentions).toEqual([]);
    });

    it('parses modifiedFiles as empty array by default', () => {
      const created = chats.create(projectId, 'claude');
      const fetched = chats.get(created.id);

      expect(fetched!.modifiedFiles).toEqual([]);
    });
  });

  describe('list', () => {
    it('returns chats for a project sorted by updated_at descending', () => {
      const c1 = chats.create(projectId, 'claude');
      const c2 = chats.create(projectId, 'claude');

      // Update c1 to make it the most recently updated
      chats.update(c1.id, { title: 'Updated Chat', updatedAt: new Date(Date.now() + 1000).toISOString() });

      const all = chats.list(projectId);
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe(c1.id);
      expect(all[1].id).toBe(c2.id);
    });

    it('excludes archived chats', () => {
      const c1 = chats.create(projectId, 'claude');
      const c2 = chats.create(projectId, 'claude');

      chats.update(c2.id, { status: 'archived' });

      const all = chats.list(projectId);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(c1.id);
    });

    it('returns empty array for a project with no chats', () => {
      const other = projects.create('/other/path', 'Other');
      expect(chats.list(other.id)).toEqual([]);
    });

    it('only returns chats for the specified project', () => {
      const p2 = projects.create('/path/b', 'Project B');
      chats.create(projectId, 'claude');
      chats.create(p2.id, 'codex');

      const result = chats.list(projectId);
      expect(result).toHaveLength(1);
      expect(result[0].projectId).toBe(projectId);
    });
  });

  describe('update', () => {
    it('updates the title', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { title: 'New Title' });

      const fetched = chats.get(chat.id);
      expect(fetched!.title).toBe('New Title');
    });

    it('updates cost and token fields', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, {
        totalCost: 0.05,
        totalTokensInput: 1500,
        totalTokensOutput: 500,
      });

      const fetched = chats.get(chat.id);
      expect(fetched!.totalCost).toBe(0.05);
      expect(fetched!.totalTokensInput).toBe(1500);
      expect(fetched!.totalTokensOutput).toBe(500);
    });

    it('updates status', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { status: 'ended' });

      const fetched = chats.get(chat.id);
      expect(fetched!.status).toBe('ended');
    });

    it('updates model', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { model: 'claude-3-sonnet' });

      const fetched = chats.get(chat.id);
      expect(fetched!.model).toBe('claude-3-sonnet');
    });

    it('updates claudeSessionId', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { claudeSessionId: 'session-123' });

      const fetched = chats.get(chat.id);
      expect(fetched!.claudeSessionId).toBe('session-123');
    });

    it('updates permissionMode', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { permissionMode: 'plan' });

      const fetched = chats.get(chat.id);
      expect(fetched!.permissionMode).toBe('plan');
    });

    it('updates worktreePath and branchName', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { worktreePath: '/tmp/wt', branchName: 'feature/test' });

      const fetched = chats.get(chat.id);
      expect(fetched!.worktreePath).toBe('/tmp/wt');
      expect(fetched!.branchName).toBe('feature/test');
    });

    it('updates processState', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { processState: 'working' });

      const fetched = chats.get(chat.id);
      expect(fetched!.processState).toBe('working');
    });

    it('updates updated_at only when explicitly passed', () => {
      const chat = chats.create(projectId, 'claude');

      // Set an old timestamp
      db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', chat.id);

      // update without updatedAt should NOT change it
      chats.update(chat.id, { title: 'Trigger update' });
      const afterTitle = chats.get(chat.id);
      expect(afterTitle!.updatedAt).toBe('2020-01-01T00:00:00.000Z');

      // update with explicit updatedAt should change it
      const now = new Date().toISOString();
      chats.update(chat.id, { updatedAt: now });
      const afterExplicit = chats.get(chat.id);
      expect(afterExplicit!.updatedAt).toBe(now);
    });

    it('updates mentions as JSON', () => {
      const chat = chats.create(projectId, 'claude');
      const mentions = [
        {
          id: 'm1',
          kind: 'file' as const,
          source: 'user' as const,
          name: 'readme',
          path: '/readme.md',
          timestamp: new Date().toISOString(),
        },
      ];
      chats.update(chat.id, { mentions });

      const fetched = chats.get(chat.id);
      expect(fetched!.mentions).toEqual(mentions);
    });

    it('pins a chat and returns pinned: true', () => {
      const chat = chats.create(projectId, 'claude');
      expect(chats.get(chat.id)!.pinned).toBe(false);

      chats.update(chat.id, { pinned: true });
      expect(chats.get(chat.id)!.pinned).toBe(true);
    });

    it('unpins a chat and returns pinned: false', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { pinned: true });
      chats.update(chat.id, { pinned: false });
      expect(chats.get(chat.id)!.pinned).toBe(false);
    });
  });

  describe('effort', () => {
    it('defaults to undefined on a new chat', () => {
      const chat = chats.create(projectId, 'claude');
      expect(chats.get(chat.id)!.effort).toBeUndefined();
    });

    it('persists each valid effort level', () => {
      const chat = chats.create(projectId, 'claude');

      chats.update(chat.id, { effort: 'low' });
      expect(chats.get(chat.id)!.effort).toBe('low');

      chats.update(chat.id, { effort: 'medium' });
      expect(chats.get(chat.id)!.effort).toBe('medium');

      chats.update(chat.id, { effort: 'high' });
      expect(chats.get(chat.id)!.effort).toBe('high');
    });

    it('clears effort when null is passed', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { effort: 'high' });
      expect(chats.get(chat.id)!.effort).toBe('high');

      // Route passes null to clear — cast mirrors the route handler's behavior.
      chats.update(chat.id, { effort: null as unknown as 'high' });
      expect(chats.get(chat.id)!.effort).toBeUndefined();
    });

    it('returns undefined for unexpected stored values', () => {
      const chat = chats.create(projectId, 'claude');
      // Legacy / corrupted rows: the parser must coerce to undefined.
      db.prepare('UPDATE chats SET effort = ? WHERE id = ?').run('max', chat.id);
      expect(chats.get(chat.id)!.effort).toBeUndefined();
    });

    it('includes effort in list() and listAll() results', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { effort: 'medium' });

      const listed = chats.list(projectId).find((c) => c.id === chat.id);
      expect(listed?.effort).toBe('medium');

      const listedAll = chats.listAll().find((c) => c.id === chat.id);
      expect(listedAll?.effort).toBe('medium');
    });
  });

  describe('schema migration', () => {
    it('initializeSchema adds the effort column to an existing chats table without it', () => {
      // Simulate pre-migration DB by starting from a fresh in-memory DB, creating
      // chats without effort, then running initializeSchema again (idempotent).
      const legacy = new Database(':memory:');
      legacy.exec(`
        CREATE TABLE chats (
          id TEXT PRIMARY KEY,
          adapter_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT,
          claude_session_id TEXT,
          model TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          total_cost REAL DEFAULT 0,
          total_tokens_input INTEGER DEFAULT 0,
          total_tokens_output INTEGER DEFAULT 0
        );
      `);
      const before = legacy.pragma('table_info(chats)') as { name: string }[];
      expect(before.some((c) => c.name === 'effort')).toBe(false);

      initializeSchema(legacy);
      const after = legacy.pragma('table_info(chats)') as { name: string }[];
      expect(after.some((c) => c.name === 'effort')).toBe(true);
      legacy.close();
    });
  });

  describe('pinned ordering', () => {
    it('list() returns pinned chats before unpinned ones', () => {
      const older = chats.create(projectId, 'claude');
      const newer = chats.create(projectId, 'claude');
      chats.update(older.id, { updatedAt: new Date(Date.now() - 5000).toISOString() });
      chats.update(newer.id, { updatedAt: new Date(Date.now()).toISOString() });

      // Pin the older chat — it should now appear first
      chats.update(older.id, { pinned: true });

      const all = chats.list(projectId);
      expect(all[0]!.id).toBe(older.id);
      expect(all[1]!.id).toBe(newer.id);
    });

    it('listAll() returns pinned chats before unpinned ones', () => {
      const c1 = chats.create(projectId, 'claude');
      const c2 = chats.create(projectId, 'claude');
      chats.update(c1.id, { updatedAt: new Date(Date.now() - 5000).toISOString() });
      chats.update(c2.id, { updatedAt: new Date(Date.now()).toISOString() });

      chats.update(c1.id, { pinned: true });

      const all = chats.listAll();
      const ids = all.map((c) => c.id);
      expect(ids.indexOf(c1.id)).toBeLessThan(ids.indexOf(c2.id));
    });
  });

  describe('mentions', () => {
    it('getMentions returns empty array for a new chat', () => {
      const chat = chats.create(projectId, 'claude');
      expect(chats.getMentions(chat.id)).toEqual([]);
    });

    it('addMention adds a mention and returns true', () => {
      const chat = chats.create(projectId, 'claude');
      const mention = {
        id: 'm1',
        kind: 'file' as const,
        source: 'user' as const,
        name: 'readme',
        path: '/readme.md',
        timestamp: new Date().toISOString(),
      };

      const added = chats.addMention(chat.id, mention);
      expect(added).toBe(true);

      const result = chats.getMentions(chat.id);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mention);
    });

    it('addMention returns false for duplicate mention', () => {
      const chat = chats.create(projectId, 'claude');
      const mention = {
        id: 'm1',
        kind: 'file' as const,
        source: 'user' as const,
        name: 'readme',
        path: '/readme.md',
        timestamp: new Date().toISOString(),
      };

      chats.addMention(chat.id, mention);
      const second = chats.addMention(chat.id, mention);
      expect(second).toBe(false);

      expect(chats.getMentions(chat.id)).toHaveLength(1);
    });
  });

  describe('plan files', () => {
    it('getPlanFiles returns empty array for a new chat', () => {
      const chat = chats.create(projectId, 'claude');
      expect(chats.getPlanFiles(chat.id)).toEqual([]);
    });

    it('addPlanFile adds a file and returns true', () => {
      const chat = chats.create(projectId, 'claude');

      const added = chats.addPlanFile(chat.id, '/plan/step1.md');
      expect(added).toBe(true);

      expect(chats.getPlanFiles(chat.id)).toEqual(['/plan/step1.md']);
    });

    it('addPlanFile returns false for duplicate', () => {
      const chat = chats.create(projectId, 'claude');

      chats.addPlanFile(chat.id, '/plan/step1.md');
      const second = chats.addPlanFile(chat.id, '/plan/step1.md');
      expect(second).toBe(false);

      expect(chats.getPlanFiles(chat.id)).toHaveLength(1);
    });
  });

  describe('skill files', () => {
    it('getSkillFiles returns empty array for a new chat', () => {
      const chat = chats.create(projectId, 'claude');
      expect(chats.getSkillFiles(chat.id)).toEqual([]);
    });

    it('addSkillFile adds an entry and returns true', () => {
      const chat = chats.create(projectId, 'claude');
      const entry = { path: '/skills/build/SKILL.md', displayName: 'build' };

      const added = chats.addSkillFile(chat.id, entry);
      expect(added).toBe(true);

      const result = chats.getSkillFiles(chat.id);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(entry);
    });

    it('addSkillFile returns false for duplicate path', () => {
      const chat = chats.create(projectId, 'claude');
      const entry = { path: '/skills/build/SKILL.md', displayName: 'build' };

      chats.addSkillFile(chat.id, entry);
      const second = chats.addSkillFile(chat.id, entry);
      expect(second).toBe(false);

      expect(chats.getSkillFiles(chat.id)).toHaveLength(1);
    });

    it('getSkillFiles migrates legacy string entries to SkillFileEntry', () => {
      const chat = chats.create(projectId, 'claude');

      // Directly insert legacy format (string array)
      db.prepare('UPDATE chats SET skill_files = ? WHERE id = ?').run(
        JSON.stringify(['/skills/deploy/SKILL.md', '/other/file.md']),
        chat.id,
      );

      const result = chats.getSkillFiles(chat.id);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ path: '/skills/deploy/SKILL.md', displayName: 'deploy' });
      expect(result[1]).toEqual({ path: '/other/file.md', displayName: 'file.md' });
    });
  });

  describe('JSON column parsing', () => {
    it('handles invalid JSON in mentions gracefully', () => {
      const chat = chats.create(projectId, 'claude');

      db.prepare('UPDATE chats SET mentions = ? WHERE id = ?').run('not valid json', chat.id);

      const fetched = chats.get(chat.id);
      expect(fetched!.mentions).toEqual([]);
    });

    it('handles invalid JSON in modified_files gracefully', () => {
      const chat = chats.create(projectId, 'claude');

      db.prepare('UPDATE chats SET modified_files = ? WHERE id = ?').run('{bad}', chat.id);

      const fetched = chats.get(chat.id);
      expect(fetched!.modifiedFiles).toEqual([]);
    });

    it('handles null JSON columns gracefully', () => {
      const chat = chats.create(projectId, 'claude');

      db.prepare('UPDATE chats SET mentions = NULL, modified_files = NULL WHERE id = ?').run(chat.id);

      const fetched = chats.get(chat.id);
      expect(fetched!.mentions).toEqual([]);
      expect(fetched!.modifiedFiles).toEqual([]);
    });
  });

  describe('worktreePath and branchName', () => {
    it('returns undefined for null worktreePath and branchName', () => {
      const chat = chats.create(projectId, 'claude');
      const fetched = chats.get(chat.id);

      expect(fetched!.worktreePath).toBeUndefined();
      expect(fetched!.branchName).toBeUndefined();
    });

    it('returns the value when set', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { worktreePath: '/tmp/wt-123', branchName: 'feat/x' });

      const fetched = chats.get(chat.id);
      expect(fetched!.worktreePath).toBe('/tmp/wt-123');
      expect(fetched!.branchName).toBe('feat/x');
    });
  });

  describe('processState', () => {
    it('defaults to null', () => {
      const chat = chats.create(projectId, 'claude');
      const fetched = chats.get(chat.id);
      expect(fetched!.processState).toBeNull();
    });

    it('can be set to working', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { processState: 'working' });

      const fetched = chats.get(chat.id);
      expect(fetched!.processState).toBe('working');
    });

    it('can be set to idle', () => {
      const chat = chats.create(projectId, 'claude');
      chats.update(chat.id, { processState: 'idle' });

      const fetched = chats.get(chat.id);
      expect(fetched!.processState).toBe('idle');
    });
  });

  describe('external session queries', () => {
    it('getImportedSessionIds returns empty array when no sessions imported', () => {
      expect(chats.getImportedSessionIds(projectId)).toEqual([]);
    });

    it('getImportedSessionIds returns session IDs for project', () => {
      const c1 = chats.create(projectId, 'claude');
      const c2 = chats.create(projectId, 'claude');
      chats.update(c1.id, { claudeSessionId: 'session-aaa' });
      chats.update(c2.id, { claudeSessionId: 'session-bbb' });

      const ids = chats.getImportedSessionIds(projectId);
      expect(ids).toHaveLength(2);
      expect(ids).toContain('session-aaa');
      expect(ids).toContain('session-bbb');
    });

    it('getImportedSessionIds excludes chats without claudeSessionId', () => {
      chats.create(projectId, 'claude'); // no session ID
      const c2 = chats.create(projectId, 'claude');
      chats.update(c2.id, { claudeSessionId: 'session-ccc' });

      const ids = chats.getImportedSessionIds(projectId);
      expect(ids).toEqual(['session-ccc']);
    });

    it('getImportedSessionIds only returns for specified project', () => {
      const p2 = projects.create('/other/project', 'Other');
      const c1 = chats.create(projectId, 'claude');
      const c2 = chats.create(p2.id, 'claude');
      chats.update(c1.id, { claudeSessionId: 'session-ddd' });
      chats.update(c2.id, { claudeSessionId: 'session-eee' });

      expect(chats.getImportedSessionIds(projectId)).toEqual(['session-ddd']);
      expect(chats.getImportedSessionIds(p2.id)).toEqual(['session-eee']);
    });

    it('findByExternalSessionId returns matching chat', () => {
      const c = chats.create(projectId, 'claude');
      chats.update(c.id, { claudeSessionId: 'session-fff' });

      const found = chats.findByExternalSessionId('session-fff', projectId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(c.id);
      expect(found!.claudeSessionId).toBe('session-fff');
    });

    it('findByExternalSessionId returns null when not found', () => {
      expect(chats.findByExternalSessionId('nonexistent', projectId)).toBeNull();
    });

    it('findByExternalSessionId scopes to project', () => {
      const p2 = projects.create('/other/project2', 'Other2');
      const c = chats.create(p2.id, 'claude');
      chats.update(c.id, { claudeSessionId: 'session-ggg' });

      // Same session ID but different project — should not find
      expect(chats.findByExternalSessionId('session-ggg', projectId)).toBeNull();
      // Correct project — should find
      expect(chats.findByExternalSessionId('session-ggg', p2.id)).not.toBeNull();
    });
  });
});
