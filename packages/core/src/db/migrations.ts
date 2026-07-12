import Database from 'better-sqlite3';

export interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

function hasColumn(db: Database.Database, table: 'chats' | 'projects' | 'devices', column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(
  db: Database.Database,
  table: 'chats' | 'projects' | 'devices',
  column: string,
  ddl: string,
): void {
  if (!hasColumn(db, table, column)) db.exec(ddl);
}

// Migration 1: the initial schema. Kept as CREATE TABLE IF NOT EXISTS so a legacy
// DB (created before user_version tracking) re-runs it as a no-op.
const BASE_SCHEMA_SQL = `
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
`;

// The chain below reproduces the historical ad-hoc schema evolution exactly, in order.
// The table_info guards stay inside each migration body so a legacy DB (all columns
// present, user_version=0) upgrades to LATEST_VERSION without re-breaking.
export const MIGRATIONS: Migration[] = [
  { version: 1, up: (db) => db.exec(BASE_SCHEMA_SQL) },
  { version: 2, up: (db) => addColumnIfMissing(db, 'chats', 'title', 'ALTER TABLE chats ADD COLUMN title TEXT') },
  {
    version: 3,
    up: (db) => addColumnIfMissing(db, 'chats', 'mentions', "ALTER TABLE chats ADD COLUMN mentions TEXT DEFAULT '[]'"),
  },
  {
    version: 4,
    up: (db) =>
      addColumnIfMissing(
        db,
        'chats',
        'modified_files',
        "ALTER TABLE chats ADD COLUMN modified_files TEXT DEFAULT '[]'",
      ),
  },
  {
    version: 5,
    up: (db) =>
      addColumnIfMissing(db, 'chats', 'plan_files', "ALTER TABLE chats ADD COLUMN plan_files TEXT DEFAULT '[]'"),
  },
  {
    version: 6,
    up: (db) =>
      addColumnIfMissing(db, 'chats', 'skill_files', "ALTER TABLE chats ADD COLUMN skill_files TEXT DEFAULT '[]'"),
  },
  {
    version: 7,
    up: (db) => addColumnIfMissing(db, 'chats', 'permission_mode', 'ALTER TABLE chats ADD COLUMN permission_mode TEXT'),
  },
  {
    version: 8,
    up: (db) => addColumnIfMissing(db, 'chats', 'worktree_path', 'ALTER TABLE chats ADD COLUMN worktree_path TEXT'),
  },
  {
    version: 9,
    up: (db) => addColumnIfMissing(db, 'chats', 'branch_name', 'ALTER TABLE chats ADD COLUMN branch_name TEXT'),
  },
  {
    version: 10,
    up: (db) => addColumnIfMissing(db, 'chats', 'process_state', 'ALTER TABLE chats ADD COLUMN process_state TEXT'),
  },
  {
    version: 11,
    up: (db) =>
      addColumnIfMissing(
        db,
        'chats',
        'last_context_tokens_input',
        'ALTER TABLE chats ADD COLUMN last_context_tokens_input INTEGER DEFAULT 0',
      ),
  },
  { version: 12, up: (db) => addColumnIfMissing(db, 'chats', 'todos', 'ALTER TABLE chats ADD COLUMN todos TEXT') },
  {
    version: 13,
    up: (db) => addColumnIfMissing(db, 'chats', 'pinned', 'ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0'),
  },
  { version: 14, up: (db) => addColumnIfMissing(db, 'chats', 'effort', 'ALTER TABLE chats ADD COLUMN effort TEXT') },
  { version: 15, up: (db) => addColumnIfMissing(db, 'chats', 'fast', 'ALTER TABLE chats ADD COLUMN fast INTEGER') },
  {
    version: 16,
    up: (db) => addColumnIfMissing(db, 'chats', 'ultracode', 'ALTER TABLE chats ADD COLUMN ultracode INTEGER'),
  },
  {
    version: 17,
    up: (db) =>
      addColumnIfMissing(db, 'chats', 'adaptive_thinking', 'ALTER TABLE chats ADD COLUMN adaptive_thinking INTEGER'),
  },
  {
    version: 18,
    up: (db) =>
      addColumnIfMissing(db, 'chats', 'detected_prs', "ALTER TABLE chats ADD COLUMN detected_prs TEXT DEFAULT '[]'"),
  },
  {
    version: 19,
    up: (db) => {
      if (!hasColumn(db, 'chats', 'plan_mode')) {
        db.exec('ALTER TABLE chats ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0');
        db.exec("UPDATE chats SET plan_mode = 1, permission_mode = 'default' WHERE permission_mode = 'plan'");
      }
    },
  },
  {
    version: 20,
    up: (db) =>
      addColumnIfMissing(db, 'chats', 'session_file_path', 'ALTER TABLE chats ADD COLUMN session_file_path TEXT'),
  },
  {
    version: 21,
    up: (db) => {
      const sdkChats = db.prepare("SELECT COUNT(*) as n FROM chats WHERE adapter_id = 'claude-sdk'").get() as {
        n: number;
      };
      if (sdkChats.n > 0) {
        db.exec("UPDATE chats SET adapter_id = 'claude' WHERE adapter_id = 'claude-sdk'");
      }
    },
  },
  {
    version: 22,
    up: (db) =>
      addColumnIfMissing(
        db,
        'projects',
        'parent_project_id',
        'ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id)',
      ),
  },
  {
    version: 23,
    up: (db) =>
      addColumnIfMissing(
        db,
        'devices',
        'auth_epoch',
        'ALTER TABLE devices ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0',
      ),
  },
  {
    version: 24,
    up: (db) => {
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
    },
  },
  {
    // Merged from main (34-commit catch-up): context-usage tracking columns +
    // transcript-missing flag on chats.
    version: 25,
    up: (db) => {
      addColumnIfMissing(
        db,
        'chats',
        'last_context_total_tokens',
        'ALTER TABLE chats ADD COLUMN last_context_total_tokens INTEGER',
      );
      addColumnIfMissing(
        db,
        'chats',
        'last_context_max_tokens',
        'ALTER TABLE chats ADD COLUMN last_context_max_tokens INTEGER',
      );
      addColumnIfMissing(
        db,
        'chats',
        'transcript_missing',
        'ALTER TABLE chats ADD COLUMN transcript_missing INTEGER DEFAULT 0',
      );
    },
  },
];

export const LATEST_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

/**
 * Applies every migration whose version is greater than the DB's current
 * `PRAGMA user_version`, stamping the version after each. Legacy DBs report
 * version 0 and re-run the whole idempotent chain; fresh DBs build from scratch.
 */
export function runMigrations(db: Database.Database, target: number = LATEST_VERSION): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const migration of MIGRATIONS) {
    if (migration.version > current && migration.version <= target) {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    }
  }
}
