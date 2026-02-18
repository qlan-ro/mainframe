import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../db/schema.js';
import { ProjectsRepository } from '../../db/projects.js';

describe('ProjectsRepository', () => {
  let db: Database.Database;
  let repo: ProjectsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    repo = new ProjectsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a project and returns it', () => {
      const project = repo.create('/home/user/my-app', 'My App');

      expect(project.id).toBeDefined();
      expect(project.name).toBe('My App');
      expect(project.path).toBe('/home/user/my-app');
      expect(project.createdAt).toBeDefined();
      expect(project.lastOpenedAt).toBeDefined();
    });

    it('derives name from path basename when name is not provided', () => {
      const project = repo.create('/home/user/cool-project');

      expect(project.name).toBe('cool-project');
    });

    it('enforces uniqueness constraint on path', () => {
      repo.create('/home/user/my-app', 'First');

      expect(() => repo.create('/home/user/my-app', 'Second')).toThrow();
    });
  });

  describe('get', () => {
    it('returns a project by id', () => {
      const created = repo.create('/home/user/my-app', 'My App');
      const fetched = repo.get(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('My App');
      expect(fetched!.path).toBe('/home/user/my-app');
    });

    it('returns falsy for a missing id', () => {
      const result = repo.get('nonexistent-id');
      expect(result).toBeFalsy();
    });
  });

  describe('getByPath', () => {
    it('returns a project by path', () => {
      const created = repo.create('/home/user/my-app', 'My App');
      const fetched = repo.getByPath('/home/user/my-app');

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    it('returns falsy for an unknown path', () => {
      const result = repo.getByPath('/nonexistent/path');
      expect(result).toBeFalsy();
    });
  });

  describe('list', () => {
    it('returns all projects sorted by last_opened_at descending', () => {
      const p1 = repo.create('/path/a', 'A');
      const p2 = repo.create('/path/b', 'B');

      // Manually set distinct timestamps so sort order is deterministic
      db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', p1.id);
      db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run('2026-01-02T00:00:00.000Z', p2.id);

      const all = repo.list();
      expect(all).toHaveLength(2);
      // p2 has the later timestamp, so it comes first
      expect(all[0].id).toBe(p2.id);
      expect(all[1].id).toBe(p1.id);
    });

    it('returns empty array when no projects exist', () => {
      expect(repo.list()).toEqual([]);
    });
  });

  describe('updateLastOpened', () => {
    it('updates the last_opened_at timestamp', () => {
      const created = repo.create('/home/user/my-app', 'My App');

      // Set an old timestamp first so the update is guaranteed to differ
      db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', created.id);

      repo.updateLastOpened(created.id);

      const fetched = repo.get(created.id);
      expect(fetched).toBeTruthy();
      expect(fetched!.lastOpenedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });
  });

  describe('remove', () => {
    it('removes a project by id', () => {
      const project = repo.create('/home/user/my-app', 'My App');
      expect(repo.get(project.id)).not.toBeNull();

      repo.remove(project.id);
      expect(repo.get(project.id)).toBeFalsy();
    });

    it('does not error when removing a nonexistent id', () => {
      expect(() => repo.remove('nonexistent-id')).not.toThrow();
    });

    it('only removes the targeted project', () => {
      const p1 = repo.create('/path/a', 'A');
      const p2 = repo.create('/path/b', 'B');

      repo.remove(p1.id);

      expect(repo.get(p1.id)).toBeFalsy();
      expect(repo.get(p2.id)).toBeTruthy();
    });
  });
});
