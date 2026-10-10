//! Opens `<dataDir>/automations.db` — a separate file from `mainframe.db`
//! (contract §3), outside its migration chain, with its own `user_version=1`.
//! The three contract tables plus `automation_webhook_state` (the one
//! webhook fact that must outlive a restart). Unknown tables in the file
//! (such as `trigger_state` / `agent_waits` from an older engine) are
//! ignored.

use mainframe_db::{
    OpenOptions,
    actor::{ActorError, SqliteActor},
    open_sqlite,
};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::StoreError;

/// Contract DDL (§3) — `CREATE TABLE IF NOT EXISTS` only, epoch-ms INTEGER
/// timestamps. `trigger_dedup_key` is NULL for manual runs: SQLite treats
/// every NULL as distinct in a UNIQUE index, so repeated manual runs never
/// collide while a duplicate scheduled/webhook fire loses the insert race.
const DDL: &str = "
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  definition TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trigger_dedup_key TEXT,
  checkpoint TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_runs_dedup ON automation_runs(automation_id, trigger_dedup_key);
CREATE INDEX IF NOT EXISTS idx_runs_automation ON automation_runs(automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_live ON automation_runs(status) WHERE status IN ('running','waiting');
CREATE TABLE IF NOT EXISTS automation_interactions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  fields TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interactions_pending ON automation_interactions(status) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS automation_webhook_state (
  hook_id TEXT PRIMARY KEY,
  last_delivery_at TEXT
);
";

#[derive(Clone)]
pub struct AutomationDb {
    actor: SqliteActor<Connection, StoreError>,
}

impl From<ActorError> for StoreError {
    fn from(error: ActorError) -> Self {
        match error {
            ActorError::Io(error) => Self::Io(error),
            other => Self::Task(other.to_string()),
        }
    }
}

impl AutomationDb {
    pub async fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path: PathBuf = path.as_ref().to_path_buf();
        tokio::task::spawn_blocking(move || Self::open_blocking(&path))
            .await
            .map_err(|e| StoreError::Task(e.to_string()))?
    }

    fn open_blocking(path: &Path) -> Result<Self, StoreError> {
        let path = path.to_path_buf();
        let actor = SqliteActor::spawn_named("mainframe-automation-db", move || {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let conn = open_sqlite(
                &path,
                OpenOptions {
                    busy_timeout: Some(Duration::from_millis(5000)),
                },
            )?;
            let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
            if version > 0 {
                mainframe_db::migrate::run_batch(&conn, DDL)?;
            }
            mainframe_db::migrate::run_versioned(
                &conn,
                &[mainframe_db::migrate::Migration {
                    version: 1,
                    up: |connection| {
                        connection.execute_batch(DDL)?;
                        Ok(())
                    },
                }],
                1,
            )
            .map_err(|error| match error {
                mainframe_db::DbError::Sqlite(error) => StoreError::Sqlite(error),
                other => StoreError::Task(other.to_string()),
            })?;
            Ok(conn)
        })?;
        Ok(Self { actor })
    }

    pub async fn call<F, R>(&self, f: F) -> Result<R, StoreError>
    where
        F: FnOnce(&mut Connection) -> Result<R, StoreError> + Send + 'static,
        R: Send + 'static,
    {
        self.actor
            .call_mut(move |conn| {
                // A failed operation must not retire the automation connection.
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(conn)))
                    .map_err(|_| StoreError::Task("database operation panicked".into()))?
            })
            .await
    }
}
