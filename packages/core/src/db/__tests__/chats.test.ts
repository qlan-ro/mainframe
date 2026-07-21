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

      // Distinct timestamps in non-insertion order, so an insertion-order
      // result can't masquerade as a correct DESC sort.
      const setUpdatedAt = db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?');
      setUpdatedAt.run('2026-01-01T00:00:02.000Z', chat1.id);
      setUpdatedAt.run('2026-01-01T00:00:03.000Z', chat2.id);
      setUpdatedAt.run('2026-01-01T00:00:01.000Z', chat3.id);

      const all = chats.listAll();
      expect(all).toHaveLength(3);
      expect(all.map((c) => c.id)).toEqual([chat2.id, chat1.id, chat3.id]);
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

  describe('resetWorkingToIdle', () => {
    it('resets only working chats and returns the affected count', () => {
      const p = projects.create('/project/reset');
      const working1 = chats.create(p.id, 'claude');
      const working2 = chats.create(p.id, 'claude');
      const idle = chats.create(p.id, 'claude');
      const unset = chats.create(p.id, 'claude'); // process_state stays NULL
      chats.update(working1.id, { processState: 'working' });
      chats.update(working2.id, { processState: 'working' });
      chats.update(idle.id, { processState: 'idle' });

      const count = chats.resetWorkingToIdle();

      expect(count).toBe(2);
      expect(chats.get(working1.id)?.processState).toBe('idle');
      expect(chats.get(working2.id)?.processState).toBe('idle');
      expect(chats.get(idle.id)?.processState).toBe('idle');
      expect(chats.get(unset.id)?.processState).toBeNull();
    });
  });
});
