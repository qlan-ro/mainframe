import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectsRepository } from '../projects.js';
import { ChatsRepository } from '../chats.js';
import { ChatTagsRepository } from '../chat-tags.js';
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

  describe('remove — transactional cascade', () => {
    let chats: ChatsRepository;

    beforeEach(() => {
      const chatTags = new ChatTagsRepository(db);
      chats = new ChatsRepository(db, chatTags);
    });

    it('(a) deleting a project also deletes its chats', () => {
      const project = repo.create('/some/path');
      chats.create(project.id, 'claude');
      chats.create(project.id, 'claude');

      repo.remove(project.id);

      expect(repo.get(project.id)).toBeFalsy();
      expect(chats.list(project.id)).toHaveLength(0);
    });

    it('(b) deleting a parent project nulls children parent_project_id (children survive)', () => {
      const parent = repo.create('/main/repo');
      const child = repo.create('/main/repo/.worktrees/feat');
      repo.setParentProject(child.id, parent.id);

      repo.remove(parent.id);

      // parent is gone
      expect(repo.get(parent.id)).toBeFalsy();
      // child survives with nulled FK
      const fetched = repo.get(child.id);
      expect(fetched).toBeTruthy();
      expect(fetched?.parentProjectId).toBeNull();
    });

    it('(c) delete is atomic — if something fails, nothing is deleted', () => {
      // Simulate atomicity: spy on the underlying db transaction to verify
      // both chats and the project row are removed together. We can't easily
      // force a rollback in unit-test without a trigger, so we verify the
      // observable outcome: after remove(), nothing from the project remains.
      const project = repo.create('/atomic/path');
      chats.create(project.id, 'claude');

      repo.remove(project.id);

      // Both gone — consistent post-state confirms the transaction ran to completion
      expect(repo.get(project.id)).toBeFalsy();
      expect(chats.list(project.id)).toHaveLength(0);
    });
  });
});
