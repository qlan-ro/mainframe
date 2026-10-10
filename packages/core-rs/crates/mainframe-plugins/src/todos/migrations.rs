//! The todos plugin's `data.db` schema through the shared versioned runner.
//! Version 1 folds the historical ad-hoc steps (the base table, the columns
//! added later, the row-number backfill) and the GitHub sync tables into one
//! transaction, so a database the old runner left at `user_version` 0
//! converges idempotently.

use mainframe_db::DbError;
use mainframe_db::migrate::{Migration, add_column_if_missing, has_column, run_versioned};
use rusqlite::Connection;

use crate::PluginError;
use crate::context::PluginContext;
use crate::todos_github::schema::apply_github_schema;

const TARGET_VERSION: i64 = 1;

const BASE_DDL: &str = "
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL DEFAULT 0,
  project_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);";

/// Columns added after the first release, for databases created before them.
const COLUMN_ADDS: &[(&str, &str)] = &[
    (
        "project_id",
        "ALTER TABLE todos ADD COLUMN project_id TEXT NOT NULL DEFAULT ''",
    ),
    (
        "dependencies",
        "ALTER TABLE todos ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]'",
    ),
];

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    up: initial_schema,
}];

pub(crate) async fn run(ctx: &PluginContext) -> Result<(), PluginError> {
    ctx.db
        .actor()?
        .call(|db| Ok(run_versioned(db, MIGRATIONS, TARGET_VERSION)?))
        .await
}

fn initial_schema(db: &Connection) -> Result<(), DbError> {
    db.execute_batch(BASE_DDL)?;
    if !has_column(db, "todos", "number")? {
        db.execute_batch("ALTER TABLE todos ADD COLUMN number INTEGER NOT NULL DEFAULT 0")?;
        backfill_numbers(db)?;
    }
    for (column, ddl) in COLUMN_ADDS {
        add_column_if_missing(db, "todos", column, ddl)?;
    }
    apply_github_schema(db)?;
    Ok(())
}

/// Rows that predate `number` get sequential numbers in creation order. The
/// historical backfill ran before `project_id` existed, so it is not
/// per-project.
fn backfill_numbers(db: &Connection) -> Result<(), DbError> {
    let mut statement = db.prepare("SELECT id FROM todos ORDER BY created_at")?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for (index, id) in ids.iter().enumerate() {
        db.execute(
            "UPDATE todos SET number = ?1 WHERE id = ?2",
            rusqlite::params![index as i64 + 1, id],
        )?;
    }
    Ok(())
}
