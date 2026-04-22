import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../db/schema.js';

describe('plan_mode column migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('adds plan_mode column defaulting to 0', () => {
    initializeSchema(db);
    const cols = db.pragma('table_info(chats)') as { name: string }[];
    expect(cols.some((c) => c.name === 'plan_mode')).toBe(true);
  });

  it("rewrites permission_mode='plan' to ('default', plan_mode=1) on migration", () => {
    // Pre-migration: create the old schema + seed a row with permission_mode='plan'
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, created_at TEXT, last_opened_at TEXT);
      CREATE TABLE chats (
        id TEXT PRIMARY KEY, adapter_id TEXT, project_id TEXT,
        status TEXT, created_at TEXT, updated_at TEXT,
        permission_mode TEXT
      );
      INSERT INTO projects VALUES ('p1', 'x', '/x', '2026', '2026');
      INSERT INTO chats VALUES ('c1', 'claude', 'p1', 'active', '2026', '2026', 'plan');
      INSERT INTO chats VALUES ('c2', 'codex', 'p1', 'active', '2026', '2026', 'default');
    `);

    initializeSchema(db);

    const rows = db.prepare('SELECT id, permission_mode, plan_mode FROM chats ORDER BY id').all() as {
      id: string;
      permission_mode: string | null;
      plan_mode: number;
    }[];
    expect(rows[0]).toEqual({ id: 'c1', permission_mode: 'default', plan_mode: 1 });
    expect(rows[1]).toEqual({ id: 'c2', permission_mode: 'default', plan_mode: 0 });
  });

  it("rewrites settings.defaultMode='plan' to ('default' + defaultPlanMode='true') on migration", () => {
    db.exec(`
      CREATE TABLE settings (id TEXT PRIMARY KEY, category TEXT, key TEXT, value TEXT, updated_at TEXT, UNIQUE(category, key));
      INSERT INTO settings VALUES ('s1', 'provider', 'claude.defaultMode', 'plan', '2026');
      INSERT INTO settings VALUES ('s2', 'provider', 'codex.defaultMode', 'acceptEdits', '2026');
    `);

    initializeSchema(db);

    const row = db
      .prepare("SELECT value FROM settings WHERE category='provider' AND key='claude.defaultMode'")
      .get() as { value: string };
    expect(row.value).toBe('default');
    const planRow = db
      .prepare("SELECT value FROM settings WHERE category='provider' AND key='claude.defaultPlanMode'")
      .get() as { value: string } | undefined;
    expect(planRow?.value).toBe('true');
  });
});
