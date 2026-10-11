//! The daemon database's [`SettingsKv`] implementation: every call is one job
//! on the database actor, running the synchronous `SettingsRepository`.

use std::collections::HashMap;

use mainframe_types::BoxFuture;
use mainframe_types::settings_kv::{SettingsError, SettingsKv, SettingsResult};

use crate::actor::SqliteActor;
use crate::{DatabaseManager, DbError};

impl From<DbError> for SettingsError {
    fn from(error: DbError) -> Self {
        Self::Store(error.to_string())
    }
}

impl SettingsKv for SqliteActor<DatabaseManager> {
    fn get<'a>(
        &'a self,
        category: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, SettingsResult<Option<String>>> {
        let (category, key) = (category.to_string(), key.to_string());
        Box::pin(async move {
            Ok(self
                .call(move |db| db.settings.get(&category, &key))
                .await?)
        })
    }

    fn get_by_category<'a>(
        &'a self,
        category: &'a str,
    ) -> BoxFuture<'a, SettingsResult<HashMap<String, String>>> {
        let category = category.to_string();
        Box::pin(async move {
            Ok(self
                .call(move |db| db.settings.get_by_category(&category))
                .await?)
        })
    }

    fn set<'a>(
        &'a self,
        category: &'a str,
        key: &'a str,
        value: &'a str,
    ) -> BoxFuture<'a, SettingsResult<()>> {
        let (category, key, value) = (category.to_string(), key.to_string(), value.to_string());
        Box::pin(async move {
            Ok(self
                .call(move |db| db.settings.set(&category, &key, &value))
                .await?)
        })
    }

    fn delete<'a>(&'a self, category: &'a str, key: &'a str) -> BoxFuture<'a, SettingsResult<()>> {
        let (category, key) = (category.to_string(), key.to_string());
        Box::pin(async move {
            Ok(self
                .call(move |db| db.settings.delete(&category, &key))
                .await?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn open() -> SqliteActor<DatabaseManager> {
        SqliteActor::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap()
    }

    #[tokio::test]
    async fn reads_and_writes_rows_through_the_actor() {
        let db = open();
        let kv: &dyn SettingsKv = &db;
        kv.set("provider", "claude.defaultModel", "opus")
            .await
            .unwrap();
        kv.set("provider", "claude.defaultModel", "sonnet")
            .await
            .unwrap();
        kv.set("provider", "codex.defaultMode", "yolo")
            .await
            .unwrap();
        kv.set("general", "worktreeDir", "trees").await.unwrap();

        assert_eq!(
            kv.get("provider", "claude.defaultModel").await.unwrap(),
            Some("sonnet".to_string())
        );
        assert_eq!(
            kv.get("general", "claude.defaultModel").await.unwrap(),
            None
        );
        assert_eq!(
            kv.get_by_category("provider").await.unwrap(),
            HashMap::from([
                ("claude.defaultModel".to_string(), "sonnet".to_string()),
                ("codex.defaultMode".to_string(), "yolo".to_string()),
            ])
        );

        kv.delete("provider", "claude.defaultModel").await.unwrap();
        kv.delete("provider", "never-stored").await.unwrap();
        assert_eq!(
            kv.get("provider", "claude.defaultModel").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_database_failure_is_an_error_not_an_absent_row() {
        let db = open();
        db.call(|d| Ok(d.connection().execute_batch("DROP TABLE settings")?))
            .await
            .unwrap();
        let kv: &dyn SettingsKv = &db;

        let SettingsError::Store(read) = kv.get("general", "worktreeDir").await.unwrap_err();
        assert_eq!(read, "no such table: settings");
        assert!(kv.get_by_category("general").await.is_err());
        assert!(kv.set("general", "worktreeDir", "x").await.is_err());
        assert!(kv.delete("general", "worktreeDir").await.is_err());
    }
}
