import type Database from 'better-sqlite3';
import type { Project } from '@mainframe/types';
import { nanoid } from 'nanoid';
import { basename } from 'node:path';

export class ProjectsRepository {
  constructor(private db: Database.Database) {}

  list(): Project[] {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt
      FROM projects
      ORDER BY last_opened_at DESC
    `);
    return stmt.all() as Project[];
  }

  get(id: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt
      FROM projects WHERE id = ?
    `);
    return stmt.get(id) as Project | null;
  }

  getByPath(path: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt
      FROM projects WHERE path = ?
    `);
    return stmt.get(path) as Project | null;
  }

  create(path: string, name?: string): Project {
    const id = nanoid();
    const now = new Date().toISOString();
    const projectName = name || basename(path);

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, path, created_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, projectName, path, now, now);

    return { id, name: projectName, path, createdAt: now, lastOpenedAt: now };
  }

  updateLastOpened(id: string): void {
    const stmt = this.db.prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`);
    stmt.run(new Date().toISOString(), id);
  }

  remove(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
    stmt.run(id);
  }

  removeWithChats(id: string): void {
    const deleteChats = this.db.prepare(`DELETE FROM chats WHERE project_id = ?`);
    const deleteProject = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
    const tx = this.db.transaction(() => {
      deleteChats.run(id);
      deleteProject.run(id);
    });
    tx();
  }
}
