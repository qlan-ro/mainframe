import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';

describe('schema — tags', () => {
  it('creates tags and chat_tags tables', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('tags');
    expect(names).toContain('chat_tags');
  });

  it('chat_tags cascades on chat deletion', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(
      'p1',
      'p',
      '/tmp/p',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c1', 'claude', 'p1', 'active', now, now);
    db.prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)').run('feature', 'blue', now);
    db.prepare("INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)").run(
      'c1',
      'feature',
      now,
    );
    db.prepare('DELETE FROM chats WHERE id = ?').run('c1');
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM chat_tags').get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});
