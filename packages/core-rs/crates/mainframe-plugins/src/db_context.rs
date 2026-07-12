//! Ported from `packages/core/src/plugins/db-context.ts`.
//!
//! `better-sqlite3` is synchronous and single-threaded. Per CONCURRENCY.tsv
//! (`plugins/db-context.ts` → per-plugin Database, class DB: "one Arc<Db> per
//! plugin — separate rusqlite conn, spawn_blocking, same handle discipline as
//! the main Db"), the connection is confined to one dedicated OS thread and every
//! query is serialized onto it via an mpsc actor — a private clone of the
//! `mainframe-server` `Db` seam, scoped to a single plugin's `data.db`.
//!
//! The generic row shape (`serde_json::Map`) mirrors better-sqlite3 returning a
//! plain JS object per row: `prepare(sql).get(...)` / `.all(...)`.

use std::path::Path;

use mainframe_adapter_api::BoxFuture;
use rusqlite::Connection;
use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::{Map, Value};
use tokio::sync::{mpsc, oneshot};

use crate::PluginError;
use crate::context::PluginDatabase;

/// A single database row as a JSON object (column name → value), matching the
/// plain object better-sqlite3 hands back.
pub type Row = Map<String, Value>;

type Job = Box<dyn FnOnce(&Connection) + Send>;

/// Per-plugin SQLite handle. Holds a `Send + Sync + Clone` mpsc sender to the
/// dedicated worker thread that owns the `Connection`.
#[derive(Clone)]
pub struct PluginDatabaseContext {
    tx: mpsc::UnboundedSender<Job>,
}

impl PluginDatabaseContext {
    /// Opens (creating the parent dirs of) the plugin's `data.db` on a dedicated
    /// worker thread, applying the same pragmas as the TS context
    /// (`journal_mode = WAL`, `foreign_keys = ON`). Open failures surface
    /// synchronously.
    pub fn open(db_path: &Path) -> Result<Self, PluginError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let path = db_path.to_path_buf();
        let (tx, mut rx) = mpsc::unbounded_channel::<Job>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), PluginError>>();

        std::thread::Builder::new()
            .name("mainframe-plugin-db".into())
            .spawn(move || {
                let conn = match open_connection(&path) {
                    Ok(conn) => {
                        if ready_tx.send(Ok(())).is_err() {
                            return;
                        }
                        conn
                    }
                    Err(err) => {
                        let _ = ready_tx.send(Err(err));
                        return;
                    }
                };
                while let Some(job) = rx.blocking_recv() {
                    job(&conn);
                }
            })
            .map_err(PluginError::Io)?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { tx }),
            Ok(Err(err)) => Err(err),
            Err(_) => Err(PluginError::Message(
                "plugin database worker failed to start".into(),
            )),
        }
    }

    /// Runs `f` on the DB thread and awaits its result. Mirrors the main Db
    /// actor's `call`; a dropped worker folds into a `PluginError`.
    async fn call<F, R>(&self, f: F) -> Result<R, PluginError>
    where
        F: FnOnce(&Connection) -> Result<R, PluginError> + Send + 'static,
        R: Send + 'static,
    {
        let (res_tx, res_rx) = oneshot::channel::<Result<R, PluginError>>();
        let job: Job = Box::new(move |conn| {
            let _ = res_tx.send(f(conn));
        });
        self.tx
            .send(job)
            .map_err(|_| PluginError::Message("plugin database worker unavailable".into()))?;
        match res_rx.await {
            Ok(result) => result,
            Err(_) => Err(PluginError::Message(
                "plugin database worker dropped the request".into(),
            )),
        }
    }
}

impl PluginDatabase for PluginDatabaseContext {
    /// `runMigration(sql)` — `db.exec(sql)`.
    fn run_migration(&self, sql: String) -> BoxFuture<'_, Result<(), PluginError>> {
        Box::pin(self.call(move |conn| {
            conn.execute_batch(&sql)?;
            Ok(())
        }))
    }

    /// `prepare(sql).run(...params)` — execute a mutating statement.
    fn execute(
        &self,
        sql: String,
        params: Vec<SqlValue>,
    ) -> BoxFuture<'_, Result<(), PluginError>> {
        Box::pin(self.call(move |conn| {
            conn.execute(&sql, rusqlite::params_from_iter(params.iter()))?;
            Ok(())
        }))
    }

    /// `prepare(sql).all(...params)` — all rows as JSON objects.
    fn query_all(
        &self,
        sql: String,
        params: Vec<SqlValue>,
    ) -> BoxFuture<'_, Result<Vec<Row>, PluginError>> {
        Box::pin(self.call(move |conn| {
            let mut stmt = conn.prepare(&sql)?;
            let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), move |row| {
                Ok(row_to_json(row, &cols))
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        }))
    }

    /// `prepare(sql).get(...params)` — the first row (or `None`).
    fn query_one(
        &self,
        sql: String,
        params: Vec<SqlValue>,
    ) -> BoxFuture<'_, Result<Option<Row>, PluginError>> {
        Box::pin(self.call(move |conn| {
            let mut stmt = conn.prepare(&sql)?;
            let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;
            match rows.next()? {
                Some(row) => Ok(Some(row_to_json(row, &cols))),
                None => Ok(None),
            }
        }))
    }
}

fn open_connection(path: &Path) -> Result<Connection, PluginError> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// Convert one row to a JSON object using the prepared statement's column names,
/// matching the plain object better-sqlite3 returns.
fn row_to_json(row: &rusqlite::Row, cols: &[String]) -> Row {
    let mut map = Map::with_capacity(cols.len());
    for (i, name) in cols.iter().enumerate() {
        let value = match row.get_ref(i) {
            Ok(ValueRef::Null) | Err(_) => Value::Null,
            Ok(ValueRef::Integer(n)) => Value::from(n),
            Ok(ValueRef::Real(f)) => Value::from(f),
            Ok(ValueRef::Text(t)) => Value::String(String::from_utf8_lossy(t).into_owned()),
            Ok(ValueRef::Blob(b)) => Value::String(String::from_utf8_lossy(b).into_owned()),
        };
        map.insert(name.clone(), value);
    }
    map
}

/// Bind helper: SQL text parameter.
pub fn text(s: impl Into<String>) -> SqlValue {
    SqlValue::Text(s.into())
}

/// Bind helper: SQL integer parameter.
pub fn int(n: i64) -> SqlValue {
    SqlValue::Integer(n)
}

/// Bind helper: nullable text (`value ?? null`).
pub fn nullable_text(s: Option<String>) -> SqlValue {
    match s {
        Some(s) => SqlValue::Text(s),
        None => SqlValue::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn open_tmp() -> (tempfile::TempDir, PluginDatabaseContext) {
        let dir = tempfile::tempdir().unwrap();
        let db = PluginDatabaseContext::open(&dir.path().join("data.db")).unwrap();
        (dir, db)
    }

    #[tokio::test]
    async fn migration_insert_and_query_roundtrip() {
        let (_dir, db) = open_tmp().await;
        db.run_migration("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)".into())
            .await
            .unwrap();
        db.execute(
            "INSERT INTO t (id, n) VALUES (?, ?)".into(),
            vec![text("a"), int(7)],
        )
        .await
        .unwrap();
        let rows = db
            .query_all("SELECT * FROM t".into(), vec![])
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], Value::from("a"));
        assert_eq!(rows[0]["n"], Value::from(7));
        let one = db
            .query_one("SELECT * FROM t WHERE id = ?".into(), vec![text("a")])
            .await
            .unwrap();
        assert!(one.is_some());
        let missing = db
            .query_one("SELECT * FROM t WHERE id = ?".into(), vec![text("zzz")])
            .await
            .unwrap();
        assert!(missing.is_none());
    }
}

// PORT STATUS: src/plugins/db-context.ts
// confidence: high
// todos: 0
// notes: per-plugin SQLite confined to a dedicated worker thread (mpsc actor),
// a scoped clone of the mainframe-server Db seam — matches better-sqlite3's
// single-threaded semantics and the tsv's per-plugin "separate rusqlite conn"
// directive. WAL + foreign_keys pragmas applied on open. Rows map to
// serde_json::Map (better-sqlite3's plain row objects); params bind via
// rusqlite::types::Value. `transaction()` is not ported — no builtin uses it
// (todos runs single statements); a WASM loader restoring third-party plugins
// would add it alongside the loader.
