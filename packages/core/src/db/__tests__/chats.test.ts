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

  describe('todos', () => {
    it('returns null when no todos have been set', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      expect(chats.getTodos(chat.id)).toBeNull();
    });

    it('stores and retrieves todos', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      const todos = [
        { content: 'Write tests', status: 'completed' as const, activeForm: 'Writing tests' },
        { content: 'Implement feature', status: 'in_progress' as const, activeForm: 'Implementing feature' },
        { content: 'Review code', status: 'pending' as const, activeForm: 'Reviewing code' },
      ];
      chats.updateTodos(chat.id, todos);
      expect(chats.getTodos(chat.id)).toEqual(todos);
    });

    it('replaces todos on subsequent calls', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      chats.updateTodos(chat.id, [{ content: 'Old task', status: 'pending' as const, activeForm: 'Old task' }]);
      const newTodos = [{ content: 'New task', status: 'in_progress' as const, activeForm: 'New task' }];
      chats.updateTodos(chat.id, newTodos);
      expect(chats.getTodos(chat.id)).toEqual(newTodos);
    });

    it('includes todos in get() result', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      const todos = [{ content: 'Task 1', status: 'pending' as const, activeForm: 'Task 1' }];
      chats.updateTodos(chat.id, todos);
      const loaded = chats.get(chat.id);
      expect(loaded?.todos).toEqual(todos);
    });

    it('includes todos in list() results', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      const todos = [{ content: 'Task 1', status: 'completed' as const, activeForm: 'Task 1' }];
      chats.updateTodos(chat.id, todos);
      const all = chats.list(p.id);
      expect(all[0]?.todos).toEqual(todos);
    });
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

    it('includes archived chats', () => {
      const p1 = projects.create('/project/one');
      const chat1 = chats.create(p1.id, 'claude');
      chats.update(chat1.id, { status: 'archived' });

      chats.create(p1.id, 'claude');

      const all = chats.listAll();
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.status)).toContain('archived');
    });
  });
});
