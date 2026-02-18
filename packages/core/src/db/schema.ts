import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
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
      title TEXT,
      claude_session_id TEXT, -- todo ext_session_id
      model TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      total_cost REAL DEFAULT 0,
      total_tokens_input INTEGER DEFAULT 0,
      total_tokens_output INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    -- Note: Messages are NOT stored here. Each CLI adapter (Claude, Codex, Gemini, OpenCode)
    -- persists its own conversation history. Mainframe streams messages for live display
    -- and relies on CLI --resume flags to restore history when resuming chats.

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

  // Migrations
  const cols = db.pragma('table_info(chats)') as { name: string }[];
  if (!cols.some((c) => c.name === 'title')) {
    db.exec('ALTER TABLE chats ADD COLUMN title TEXT');
  }
  if (!cols.some((c) => c.name === 'mentions')) {
    db.exec("ALTER TABLE chats ADD COLUMN mentions TEXT DEFAULT '[]'");
  }
  if (!cols.some((c) => c.name === 'modified_files')) {
    db.exec("ALTER TABLE chats ADD COLUMN modified_files TEXT DEFAULT '[]'");
  }
  if (!cols.some((c) => c.name === 'plan_files')) {
    db.exec("ALTER TABLE chats ADD COLUMN plan_files TEXT DEFAULT '[]'");
  }
  if (!cols.some((c) => c.name === 'skill_files')) {
    db.exec("ALTER TABLE chats ADD COLUMN skill_files TEXT DEFAULT '[]'");
  }
  if (!cols.some((c) => c.name === 'permission_mode')) {
    db.exec('ALTER TABLE chats ADD COLUMN permission_mode TEXT');
  }
  if (!cols.some((c) => c.name === 'worktree_path')) {
    db.exec('ALTER TABLE chats ADD COLUMN worktree_path TEXT');
  }
  if (!cols.some((c) => c.name === 'branch_name')) {
    db.exec('ALTER TABLE chats ADD COLUMN branch_name TEXT');
  }
  if (!cols.some((c) => c.name === 'process_state')) {
    db.exec('ALTER TABLE chats ADD COLUMN process_state TEXT');
  }
  if (!cols.some((c) => c.name === 'last_context_tokens_input')) {
    db.exec('ALTER TABLE chats ADD COLUMN last_context_tokens_input INTEGER DEFAULT 0');
  }
}
