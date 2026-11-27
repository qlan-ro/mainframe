//! Each plugin with `storage` gets its own `data.db`, opened with the same
//! handle discipline as the daemon database: one connection confined to a
//! dedicated OS thread (`mainframe_db::actor::SqliteActor`), with every query
//! serialized onto it.

use std::path::Path;
use std::time::Duration;

use mainframe_db::{
    OpenOptions,
    actor::{ActorError, SqliteActor},
    open_sqlite,
};
use rusqlite::Connection;

use crate::PluginError;

pub type PluginSqlite = SqliteActor<Connection, PluginError>;

/// How long a statement waits on a lock held by another connection (outside
/// writers such as the `todos` skill open `data.db` directly) before failing
/// with `SQLITE_BUSY`. Matches the automations store.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

impl From<ActorError> for PluginError {
    fn from(error: ActorError) -> Self {
        match error {
            ActorError::Io(error) => Self::Io(error),
            ActorError::Worker(what) => Self::Worker(what),
        }
    }
}

/// Opens (creating the parent dirs of) the plugin's `data.db` on a dedicated
/// worker thread with the shared pragmas and a 5 s busy timeout. Open
/// failures surface synchronously.
pub(crate) fn open_plugin_db(db_path: &Path) -> Result<PluginSqlite, PluginError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let path = db_path.to_path_buf();
    SqliteActor::spawn_named("mainframe-plugin-db", move || {
        let options = OpenOptions {
            busy_timeout: Some(BUSY_TIMEOUT),
        };
        Ok::<_, PluginError>(open_sqlite(&path, options)?)
    })
}

/// Raw SQL against a plugin's `data.db`, for tests that seed or inspect
/// tables the typed stores do not expose. Rows come back as JSON objects.
#[cfg(test)]
pub(crate) mod test_sql {
    use rusqlite::types::{Value as SqlValue, ValueRef};
    use serde_json::{Map, Value};

    use crate::PluginError;
    use crate::context::PluginContext;

    pub(crate) type Row = Map<String, Value>;

    pub(crate) fn text(s: impl Into<String>) -> SqlValue {
        SqlValue::Text(s.into())
    }

    pub(crate) trait RawSql {
        async fn raw_execute(&self, sql: &str, params: Vec<SqlValue>) -> Result<(), PluginError>;
        async fn raw_query_all(
            &self,
            sql: &str,
            params: Vec<SqlValue>,
        ) -> Result<Vec<Row>, PluginError>;
        async fn raw_query_one(
            &self,
            sql: &str,
            params: Vec<SqlValue>,
        ) -> Result<Option<Row>, PluginError> {
            Ok(self.raw_query_all(sql, params).await?.into_iter().next())
        }
    }

    impl RawSql for PluginContext {
        async fn raw_execute(&self, sql: &str, params: Vec<SqlValue>) -> Result<(), PluginError> {
            let sql = sql.to_string();
            self.db()?
                .call(move |db| {
                    db.execute(&sql, rusqlite::params_from_iter(params))?;
                    Ok(())
                })
                .await
        }

        async fn raw_query_all(
            &self,
            sql: &str,
            params: Vec<SqlValue>,
        ) -> Result<Vec<Row>, PluginError> {
            let sql = sql.to_string();
            self.db()?
                .call(move |db| {
                    let mut statement = db.prepare(&sql)?;
                    let columns: Vec<String> = statement
                        .column_names()
                        .iter()
                        .map(|name| name.to_string())
                        .collect();
                    let mut rows = statement.query(rusqlite::params_from_iter(params))?;
                    let mut out = Vec::new();
                    while let Some(row) = rows.next()? {
                        let mut map = Map::with_capacity(columns.len());
                        for (index, name) in columns.iter().enumerate() {
                            let value = match row.get_ref(index)? {
                                ValueRef::Null => Value::Null,
                                ValueRef::Integer(n) => Value::from(n),
                                ValueRef::Real(f) => Value::from(f),
                                ValueRef::Text(t) | ValueRef::Blob(t) => {
                                    Value::String(String::from_utf8_lossy(t).into_owned())
                                }
                            };
                            map.insert(name.clone(), value);
                        }
                        out.push(map);
                    }
                    Ok(out)
                })
                .await
        }
    }
}
