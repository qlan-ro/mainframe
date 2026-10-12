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
#[path = "settings_kv_tests.rs"]
mod tests;
