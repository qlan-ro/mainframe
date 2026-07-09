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

    CREATE TABLE IF NOT EXISTS devices (
      device_id   TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      last_seen   TEXT,
      auth_epoch  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      name       TEXT PRIMARY KEY,
      color      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_tags (
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      tag        TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE,
      source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, tag, source)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_tags_chat ON chat_tags(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chat_tags_tag  ON chat_tags(tag);
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
  if (!cols.some((c) => c.name === 'todos')) {
    db.exec('ALTER TABLE chats ADD COLUMN todos TEXT');
  }
  if (!cols.some((c) => c.name === 'pinned')) {
    db.exec('ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'effort')) {
    db.exec('ALTER TABLE chats ADD COLUMN effort TEXT');
  }
  if (!cols.some((c) => c.name === 'fast')) db.exec('ALTER TABLE chats ADD COLUMN fast INTEGER');
  if (!cols.some((c) => c.name === 'ultracode')) db.exec('ALTER TABLE chats ADD COLUMN ultracode INTEGER');
  if (!cols.some((c) => c.name === 'adaptive_thinking'))
    db.exec('ALTER TABLE chats ADD COLUMN adaptive_thinking INTEGER');
  if (!cols.some((c) => c.name === 'detected_prs')) {
    db.exec("ALTER TABLE chats ADD COLUMN detected_prs TEXT DEFAULT '[]'");
  }
  if (!cols.some((c) => c.name === 'plan_mode')) {
    db.exec('ALTER TABLE chats ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE chats SET plan_mode = 1, permission_mode = 'default' WHERE permission_mode = 'plan'");
  }
  if (!cols.some((c) => c.name === 'session_file_path')) {
    db.exec('ALTER TABLE chats ADD COLUMN session_file_path TEXT');
  }
  if (!cols.some((c) => c.name === 'transcript_missing')) {
    db.exec('ALTER TABLE chats ADD COLUMN transcript_missing INTEGER DEFAULT 0');
  }

  const sdkChats = db.prepare("SELECT COUNT(*) as n FROM chats WHERE adapter_id = 'claude-sdk'").get() as { n: number };
  if (sdkChats.n > 0) {
    db.exec("UPDATE chats SET adapter_id = 'claude' WHERE adapter_id = 'claude-sdk'");
  }

  const projectCols = db.pragma('table_info(projects)') as { name: string }[];
  if (!projectCols.some((c) => c.name === 'parent_project_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id)');
  }

  const deviceCols = db.pragma('table_info(devices)') as { name: string }[];
  if (!deviceCols.some((c) => c.name === 'auth_epoch')) {
    db.exec('ALTER TABLE devices ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0');
  }

  const planModeSettings = db
    .prepare("SELECT id, key FROM settings WHERE category='provider' AND key LIKE '%.defaultMode' AND value='plan'")
    .all() as { id: string; key: string }[];
  for (const { id, key } of planModeSettings) {
    const now = new Date().toISOString();
    const prefix = key.slice(0, -'.defaultMode'.length);
    const planKey = `${prefix}.defaultPlanMode`;
    db.prepare("UPDATE settings SET value='default', updated_at=? WHERE id=?").run(now, id);
    db.prepare(
      `INSERT INTO settings (id, category, key, value, updated_at)
       VALUES (?, 'provider', ?, 'true', ?)
       ON CONFLICT(category, key) DO UPDATE SET value='true', updated_at=excluded.updated_at`,
    ).run(`${id}-plan`, planKey, now);
  }
}
