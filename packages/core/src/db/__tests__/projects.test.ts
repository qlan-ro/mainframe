import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectsRepository } from '../projects.js';
import { initializeSchema } from '../schema.js';

describe('ProjectsRepository', () => {
  let db: Database.Database;
  let repo: ProjectsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    repo = new ProjectsRepository(db);
  });

  describe('parentProjectId', () => {
    it('returns parentProjectId as null for regular projects', () => {
      const project = repo.create('/path/to/repo');
      expect(project.parentProjectId).toBeNull();

      const fetched = repo.get(project.id);
      expect(fetched?.parentProjectId).toBeNull();
    });

    it('returns parentProjectId in list()', () => {
      repo.create('/path/to/repo');
      const projects = repo.list();
      expect(projects[0]?.parentProjectId).toBeNull();
    });

    it('returns parentProjectId in getByPath()', () => {
      repo.create('/path/to/repo');
      const project = repo.getByPath('/path/to/repo');
      expect(project?.parentProjectId).toBeNull();
    });
  });

  describe('setParentProject', () => {
    it('sets parent_project_id on a project', () => {
      const parent = repo.create('/main/repo');
      const worktree = repo.create('/main/repo/.worktrees/feat');

      repo.setParentProject(worktree.id, parent.id);

      const fetched = repo.get(worktree.id);
      expect(fetched?.parentProjectId).toBe(parent.id);
    });

    it('clears parent_project_id when clearParentProject is called', () => {
      const parent = repo.create('/main/repo');
      const worktree = repo.create('/main/repo/.worktrees/feat');

      repo.setParentProject(worktree.id, parent.id);
      repo.clearParentProject(parent.id);

      const fetched = repo.get(worktree.id);
      expect(fetched?.parentProjectId).toBeNull();
    });
  });
});
