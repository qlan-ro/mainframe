//! Each plugin gets its own rusqlite connection to its `data.db`, with the
//! same handle discipline as the daemon database: the connection is confined
//! to one dedicated OS thread (the shared `mainframe_db::actor::SqliteActor`)
//! and every query is serialized onto it, scoped to a single plugin's
//! `data.db`.
//!
//! The generic row shape (`serde_json::Map`) is one plain JSON object per
//! row. Builtin plugins can also reach the typed actor through
//! `PluginDatabase::actor`.

use std::path::Path;
use std::time::Duration;

use mainframe_adapter_api::BoxFuture;
use mainframe_db::{
    OpenOptions,
    actor::{ActorError, SqliteActor},
    open_sqlite,
};
use rusqlite::Connection;
use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::{Map, Value};

use crate::PluginError;
use crate::context::PluginDatabase;

/// A single database row as a JSON object (column name → value), matching the
/// plain object better-sqlite3 hands back.
pub type Row = Map<String, Value>;
pub type PluginSqlite = SqliteActor<Connection, PluginError>;

/// How long a statement waits on a lock held by another connection (outside
/// writers such as the `todos` skill open `data.db` directly) before failing
/// with `SQLITE_BUSY`. Matches the automations store.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct PluginDatabaseContext {
    actor: PluginSqlite,
}

impl From<ActorError> for PluginError {
    fn from(error: ActorError) -> Self {
        match error {
            ActorError::Io(error) => Self::Io(error),
            other => Self::Message(format!("plugin {other}")),
        }
    }
}

impl PluginDatabaseContext {
    /// Opens (creating the parent dirs of) the plugin's `data.db` on a
    /// dedicated worker thread, applying `journal_mode = WAL`,
    /// `foreign_keys = ON` and a 5 s busy timeout. Open failures surface
    /// synchronously.
    pub fn open(db_path: &Path) -> Result<Self, PluginError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let path = db_path.to_path_buf();
        let actor = SqliteActor::spawn_named("mainframe-plugin-db", move || {
            let options = OpenOptions {
                busy_timeout: Some(BUSY_TIMEOUT),
            };
            Ok::<_, PluginError>(open_sqlite(&path, options)?)
        })?;
        Ok(Self { actor })
    }

    /// Runs `f` on the DB thread and awaits its result.
    async fn call<F, R>(&self, f: F) -> Result<R, PluginError>
    where
        F: FnOnce(&Connection) -> Result<R, PluginError> + Send + 'static,
        R: Send + 'static,
    {
        self.actor.call(move |connection| f(connection)).await
    }
}

impl PluginDatabase for PluginDatabaseContext {
    fn actor(&self) -> Result<&PluginSqlite, PluginError> {
        Ok(&self.actor)
    }

    /// `runMigration(sql)` — `db.exec(sql)` inside one transaction, so a
    /// failing statement leaves none of the batch applied.
    ///
    /// Plugin migration SQL must therefore not contain `BEGIN`/`COMMIT`
    /// (SQLite does not nest transactions, so the batch fails) or
    /// `PRAGMA journal_mode` (it cannot change inside a transaction); the
    /// connection is already opened in WAL mode.
    fn run_migration(&self, sql: String) -> BoxFuture<'_, Result<(), PluginError>> {
        Box::pin(self.call(move |conn| {
            mainframe_db::migrate::run_batch(conn, &sql)?;
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
pub(crate) fn nullable_text(s: Option<String>) -> SqlValue {
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
