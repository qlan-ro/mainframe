//! A [`SettingsKv`] whose every call fails, for the store-failure paths.

use std::collections::HashMap;

use mainframe_types::BoxFuture;
use mainframe_types::settings_kv::{SettingsError, SettingsKv, SettingsResult};

pub(crate) struct FailingSettings;

fn failure<'a, T: Send + 'a>() -> BoxFuture<'a, SettingsResult<T>> {
    Box::pin(async { Err(SettingsError::Store("database is locked".into())) })
}

impl SettingsKv for FailingSettings {
    fn get<'a>(&'a self, _: &'a str, _: &'a str) -> BoxFuture<'a, SettingsResult<Option<String>>> {
        failure()
    }
    fn get_by_category<'a>(
        &'a self,
        _: &'a str,
    ) -> BoxFuture<'a, SettingsResult<HashMap<String, String>>> {
        failure()
    }
    fn set<'a>(&'a self, _: &'a str, _: &'a str, _: &'a str) -> BoxFuture<'a, SettingsResult<()>> {
        failure()
    }
    fn delete<'a>(&'a self, _: &'a str, _: &'a str) -> BoxFuture<'a, SettingsResult<()>> {
        failure()
    }
}
