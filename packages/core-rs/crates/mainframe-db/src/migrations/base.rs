pub(super) const BASE_SCHEMA_SQL: &str = r#"
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
"#;
