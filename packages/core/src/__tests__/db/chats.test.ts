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
      chats.update(c1.id, { title: 'Updated Chat' });

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

    it('always updates updated_at', () => {
      const chat = chats.create(projectId, 'claude');

      // Set an old timestamp so the update is guaranteed to differ
      db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', chat.id);

      chats.update(chat.id, { title: 'Trigger update' });

      const fetched = chats.get(chat.id);
      expect(fetched!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
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

  describe('modified files', () => {
    it('getModifiedFilesList returns empty array for a new chat', () => {
      const chat = chats.create(projectId, 'claude');
      expect(chats.getModifiedFilesList(chat.id)).toEqual([]);
    });

    it('addModifiedFile adds a file and returns true', () => {
      const chat = chats.create(projectId, 'claude');

      const added = chats.addModifiedFile(chat.id, '/src/index.ts');
      expect(added).toBe(true);

      const result = chats.getModifiedFilesList(chat.id);
      expect(result).toEqual(['/src/index.ts']);
    });

    it('addModifiedFile returns false for duplicate path', () => {
      const chat = chats.create(projectId, 'claude');

      chats.addModifiedFile(chat.id, '/src/index.ts');
      const second = chats.addModifiedFile(chat.id, '/src/index.ts');
      expect(second).toBe(false);

      expect(chats.getModifiedFilesList(chat.id)).toHaveLength(1);
    });

    it('addModifiedFile accumulates multiple files', () => {
      const chat = chats.create(projectId, 'claude');

      chats.addModifiedFile(chat.id, '/src/a.ts');
      chats.addModifiedFile(chat.id, '/src/b.ts');

      expect(chats.getModifiedFilesList(chat.id)).toEqual(['/src/a.ts', '/src/b.ts']);
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
});
