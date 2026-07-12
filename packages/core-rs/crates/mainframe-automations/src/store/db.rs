//! Opens `<dataDir>/automations.db` — a separate file from `mainframe.db`
//! (contract §3), outside its migration chain, with its own `user_version=1`.
//! Only the three contract tables are created; Node's `trigger_state` /
//! `agent_waits` are that engine's private caches and both engines ignore
//! unknown tables in the file.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

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
";

/// The rusqlite `Connection` is `Send + !Sync`; it lives behind an
/// `Arc<Mutex<_>>` and every query runs inside `spawn_blocking` so the
/// event loop never blocks on SQLite I/O.
#[derive(Clone)]
pub struct AutomationDb {
    conn: Arc<Mutex<Connection>>,
}

impl AutomationDb {
    pub async fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path: PathBuf = path.as_ref().to_path_buf();
        tokio::task::spawn_blocking(move || Self::open_blocking(&path))
            .await
            .map_err(|e| StoreError::Task(e.to_string()))?
    }

    fn open_blocking(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
        )?;
        conn.execute_batch(DDL)?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version == 0 {
            conn.execute_batch("PRAGMA user_version = 1")?;
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Runs `f` on a blocking worker with exclusive access to the connection.
    /// The typed stores are the intended interface; this is their (and the
    /// tests') single funnel to the connection.
    pub async fn call<F, R>(&self, f: F) -> Result<R, StoreError>
    where
        F: FnOnce(&mut Connection) -> Result<R, StoreError> + Send + 'static,
        R: Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            // A poisoned mutex only means another worker panicked mid-query;
            // the connection itself is still usable, so recover the guard.
            let mut guard = conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            f(&mut guard)
        })
        .await
        .map_err(|e| StoreError::Task(e.to_string()))?
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.1), not a TS port
// confidence: high
// todos: 0
// notes: DDL column shapes match Node's db.ts exactly (shared automations.db);
//        index names follow this plan's T2.1 (uq_runs_dedup, idx_runs_*) —
//        Node creates its own names, both are IF NOT EXISTS and coexist.
