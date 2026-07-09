//! Ported from `packages/core/src/db/migrations.ts`.

use mainframe_runtime::time::now_iso8601;
use rusqlite::Connection;

use crate::DbError;

type MigrationFn = fn(&Connection) -> Result<(), DbError>;

pub struct Migration {
    pub version: i64,
    pub up: MigrationFn,
}

fn has_column(db: &Connection, table: &str, column: &str) -> Result<bool, DbError> {
    // `table` is always one of the three hard-coded literals below (never user
    // input), so interpolating it into the PRAGMA is safe.
    let mut stmt = db.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn add_column_if_missing(
    db: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), DbError> {
    if !has_column(db, table, column)? {
        db.execute_batch(ddl)?;
    }
    Ok(())
}

// Migration 1: the initial schema. Kept as CREATE TABLE IF NOT EXISTS so a legacy
// DB (created before user_version tracking) re-runs it as a no-op.
const BASE_SCHEMA_SQL: &str = r#"
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

// The chain below reproduces the historical ad-hoc schema evolution exactly, in
// order. The table_info guards stay inside each migration body so a legacy DB
// (all columns present, user_version=0) upgrades to LATEST_VERSION without
// re-breaking.
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            up: |db| {
                db.execute_batch(BASE_SCHEMA_SQL)?;
                Ok(())
            },
        },
        Migration {
            version: 2,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "title",
                    "ALTER TABLE chats ADD COLUMN title TEXT",
                )
            },
        },
        Migration {
            version: 3,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "mentions",
                    "ALTER TABLE chats ADD COLUMN mentions TEXT DEFAULT '[]'",
                )
            },
        },
        Migration {
            version: 4,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "modified_files",
                    "ALTER TABLE chats ADD COLUMN modified_files TEXT DEFAULT '[]'",
                )
            },
        },
        Migration {
            version: 5,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "plan_files",
                    "ALTER TABLE chats ADD COLUMN plan_files TEXT DEFAULT '[]'",
                )
            },
        },
        Migration {
            version: 6,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "skill_files",
                    "ALTER TABLE chats ADD COLUMN skill_files TEXT DEFAULT '[]'",
                )
            },
        },
        Migration {
            version: 7,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "permission_mode",
                    "ALTER TABLE chats ADD COLUMN permission_mode TEXT",
                )
            },
        },
        Migration {
            version: 8,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "worktree_path",
                    "ALTER TABLE chats ADD COLUMN worktree_path TEXT",
                )
            },
        },
        Migration {
            version: 9,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "branch_name",
                    "ALTER TABLE chats ADD COLUMN branch_name TEXT",
                )
            },
        },
        Migration {
            version: 10,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "process_state",
                    "ALTER TABLE chats ADD COLUMN process_state TEXT",
                )
            },
        },
        Migration {
            version: 11,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "last_context_tokens_input",
                    "ALTER TABLE chats ADD COLUMN last_context_tokens_input INTEGER DEFAULT 0",
                )
            },
        },
        Migration {
            version: 12,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "todos",
                    "ALTER TABLE chats ADD COLUMN todos TEXT",
                )
            },
        },
        Migration {
            version: 13,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "pinned",
                    "ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0",
                )
            },
        },
        Migration {
            version: 14,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "effort",
                    "ALTER TABLE chats ADD COLUMN effort TEXT",
                )
            },
        },
        Migration {
            version: 15,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "fast",
                    "ALTER TABLE chats ADD COLUMN fast INTEGER",
                )
            },
        },
        Migration {
            version: 16,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "ultracode",
                    "ALTER TABLE chats ADD COLUMN ultracode INTEGER",
                )
            },
        },
        Migration {
            version: 17,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "adaptive_thinking",
                    "ALTER TABLE chats ADD COLUMN adaptive_thinking INTEGER",
                )
            },
        },
        Migration {
            version: 18,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "detected_prs",
                    "ALTER TABLE chats ADD COLUMN detected_prs TEXT DEFAULT '[]'",
                )
            },
        },
        Migration {
            version: 19,
            up: |db| {
                if !has_column(db, "chats", "plan_mode")? {
                    db.execute_batch(
                        "ALTER TABLE chats ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0",
                    )?;
                    db.execute_batch(
                        "UPDATE chats SET plan_mode = 1, permission_mode = 'default' WHERE permission_mode = 'plan'",
                    )?;
                }
                Ok(())
            },
        },
        Migration {
            version: 20,
            up: |db| {
                add_column_if_missing(
                    db,
                    "chats",
                    "session_file_path",
                    "ALTER TABLE chats ADD COLUMN session_file_path TEXT",
                )
            },
        },
        Migration {
            version: 21,
            up: |db| {
                let n: i64 = db.query_row(
                    "SELECT COUNT(*) as n FROM chats WHERE adapter_id = 'claude-sdk'",
                    [],
                    |row| row.get(0),
                )?;
                if n > 0 {
                    db.execute_batch(
                        "UPDATE chats SET adapter_id = 'claude' WHERE adapter_id = 'claude-sdk'",
                    )?;
                }
                Ok(())
            },
        },
        Migration {
            version: 22,
            up: |db| {
                add_column_if_missing(
                    db,
                    "projects",
                    "parent_project_id",
                    "ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id)",
                )
            },
        },
        Migration {
            version: 23,
            up: |db| {
                add_column_if_missing(
                    db,
                    "devices",
                    "auth_epoch",
                    "ALTER TABLE devices ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0",
                )
            },
        },
        Migration {
            version: 24,
            up: |db| {
                let plan_mode_settings: Vec<(String, String)> = {
                    let mut stmt = db.prepare(
                        "SELECT id, key FROM settings WHERE category='provider' AND key LIKE '%.defaultMode' AND value='plan'",
                    )?;
                    let rows = stmt.query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?;
                    rows.collect::<Result<Vec<_>, _>>()?
                };
                for (id, key) in plan_mode_settings {
                    let now = now_iso8601();
                    let prefix = &key[..key.len() - ".defaultMode".len()];
                    let plan_key = format!("{prefix}.defaultPlanMode");
                    db.execute(
                        "UPDATE settings SET value='default', updated_at=? WHERE id=?",
                        rusqlite::params![now, id],
                    )?;
                    db.execute(
                        "INSERT INTO settings (id, category, key, value, updated_at)
                         VALUES (?, 'provider', ?, 'true', ?)
                         ON CONFLICT(category, key) DO UPDATE SET value='true', updated_at=excluded.updated_at",
                        rusqlite::params![format!("{id}-plan"), plan_key, now],
                    )?;
                }
                Ok(())
            },
        },
    ]
}

/// Highest migration version — the target a fresh DB stamps to.
pub const LATEST_VERSION: i64 = 24;

fn user_version(db: &Connection) -> Result<i64, DbError> {
    Ok(db.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

/// Applies every migration whose version is greater than the DB's current
/// `PRAGMA user_version`, stamping the version after each. Legacy DBs report
/// version 0 and re-run the whole idempotent chain; fresh DBs build from scratch.
pub fn run_migrations(db: &Connection, target: i64) -> Result<(), DbError> {
    let current = user_version(db)?;
    for migration in migrations() {
        if migration.version > current && migration.version <= target {
            (migration.up)(db)?;
            db.pragma_update(None, "user_version", migration.version)?;
        }
    }
    Ok(())
}

// PORT STATUS: src/db/migrations.ts (253 lines)
// confidence: high
// notes: same 24 numbered migrations, same in-body table_info guards and data
// backfills, same LATEST_VERSION=24. MIGRATIONS (const array in TS) becomes
// migrations() returning a Vec<Migration> with non-capturing closures coerced to
// fn pointers (a Vec can't be const). LATEST_VERSION is a const literal (24)
// rather than MIGRATIONS[last].version; tests/migrations.rs asserts they agree.
// The TS default param `target=LATEST_VERSION` becomes an explicit argument
// (schema::initialize_schema passes LATEST_VERSION). now_iso8601() from
// mainframe_runtime keeps `new Date().toISOString()` wire parity in migration 24.
// todos: 0
