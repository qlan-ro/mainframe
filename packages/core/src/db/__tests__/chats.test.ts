import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatsRepository } from '../chats.js';
import { ProjectsRepository } from '../projects.js';
import { initializeSchema } from '../schema.js';

describe('ChatsRepository', () => {
  let db: Database.Database;
  let chats: ChatsRepository;
  let projects: ProjectsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    chats = new ChatsRepository(db);
    projects = new ProjectsRepository(db);
  });

  describe('listAll', () => {
    it('returns chats across all projects sorted by updatedAt DESC', () => {
      const p1 = projects.create('/project/one');
      const p2 = projects.create('/project/two');

      const chat1 = chats.create(p1.id, 'claude');
      const chat2 = chats.create(p2.id, 'claude');
      const chat3 = chats.create(p1.id, 'claude');

      const all = chats.listAll();
      expect(all).toHaveLength(3);
      // Most recent first
      expect(all[0]!.id).toBe(chat3.id);
      expect(all[1]!.id).toBe(chat2.id);
      expect(all[2]!.id).toBe(chat1.id);
    });

    it('excludes archived chats', () => {
      const p1 = projects.create('/project/one');
      const chat1 = chats.create(p1.id, 'claude');
      chats.update(chat1.id, { status: 'archived' });

      chats.create(p1.id, 'claude');

      const all = chats.listAll();
      expect(all).toHaveLength(1);
    });
  });
});
