import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../db/schema.js';

describe('initializeSchema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates the projects table', () => {
    initializeSchema(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").all() as {
      name: string;
    }[];
    expect(tables).toHaveLength(1);

    const cols = db.pragma('table_info(projects)') as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('path');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('last_opened_at');
  });

  it('creates the chats table with all columns including migrations', () => {
    initializeSchema(db);

    const cols = db.pragma('table_info(chats)') as { name: string }[];
    const colNames = cols.map((c) => c.name);

    // Core columns
    expect(colNames).toContain('id');
    expect(colNames).toContain('adapter_id');
    expect(colNames).toContain('project_id');
    expect(colNames).toContain('status');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(colNames).toContain('total_cost');
    expect(colNames).toContain('total_tokens_input');
    expect(colNames).toContain('total_tokens_output');

    // Migration columns
    expect(colNames).toContain('title');
    expect(colNames).toContain('mentions');
    expect(colNames).toContain('modified_files');
    expect(colNames).toContain('plan_files');
    expect(colNames).toContain('skill_files');
    expect(colNames).toContain('permission_mode');
    expect(colNames).toContain('worktree_path');
    expect(colNames).toContain('branch_name');
    expect(colNames).toContain('process_state');
    expect(colNames).toContain('last_context_tokens_input');
  });

  it('creates the settings table', () => {
    initializeSchema(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").all() as {
      name: string;
    }[];
    expect(tables).toHaveLength(1);

    const cols = db.pragma('table_info(settings)') as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('category');
    expect(colNames).toContain('key');
    expect(colNames).toContain('value');
    expect(colNames).toContain('updated_at');
  });

  it('creates expected indexes', () => {
    initializeSchema(db);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_chats_project');
    expect(indexNames).toContain('idx_settings_category');
    expect(indexNames).toContain('idx_settings_composite');
    expect(indexNames).toContain('idx_projects_path');
  });

  it('is idempotent — running twice does not error', () => {
    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
  });

  it('applies migrations to a pre-existing schema without migration columns', () => {
    // Create a chats table that lacks migration columns (simulating old schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        claude_session_id TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        total_cost REAL DEFAULT 0,
        total_tokens_input INTEGER DEFAULT 0,
        total_tokens_output INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(category, key)
      );

      CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
      CREATE INDEX IF NOT EXISTS idx_settings_composite ON settings(category, key);
      CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
    `);

    // Verify migration columns are NOT present yet
    const colsBefore = db.pragma('table_info(chats)') as { name: string }[];
    const namesBefore = colsBefore.map((c) => c.name);
    expect(namesBefore).not.toContain('mentions');
    expect(namesBefore).not.toContain('modified_files');

    // Run initializeSchema — should add missing migration columns
    initializeSchema(db);

    const colsAfter = db.pragma('table_info(chats)') as { name: string }[];
    const namesAfter = colsAfter.map((c) => c.name);
    expect(namesAfter).toContain('title');
    expect(namesAfter).toContain('mentions');
    expect(namesAfter).toContain('modified_files');
    expect(namesAfter).toContain('plan_files');
    expect(namesAfter).toContain('skill_files');
    expect(namesAfter).toContain('permission_mode');
    expect(namesAfter).toContain('worktree_path');
    expect(namesAfter).toContain('branch_name');
    expect(namesAfter).toContain('process_state');
  });
});
