//! The settings key-value contract: `(category, key) -> value` rows in the
//! daemon's `settings` table. One async trait every crate reads and writes
//! settings through; the database implements it once on its actor handle, and
//! [`MemorySettings`] backs snapshots and tests.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::BoxFuture;
use crate::sync::LockExt as _;

/// The settings store could not be read or written.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    /// The backing store failed; carries its error text.
    #[error("settings store: {0}")]
    Store(String),
}

pub type SettingsResult<T> = Result<T, SettingsError>;

/// Async access to the settings rows. Object-safe so callers can hold
/// `&dyn SettingsKv` / `Arc<dyn SettingsKv>` without knowing the backend.
pub trait SettingsKv: Send + Sync {
    /// The stored value, or `None` when the row is absent.
    fn get<'a>(
        &'a self,
        category: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, SettingsResult<Option<String>>>;
    /// Every `key -> value` row stored under `category`.
    fn get_by_category<'a>(
        &'a self,
        category: &'a str,
    ) -> BoxFuture<'a, SettingsResult<HashMap<String, String>>>;
    /// Insert or overwrite one row.
    fn set<'a>(
        &'a self,
        category: &'a str,
        key: &'a str,
        value: &'a str,
    ) -> BoxFuture<'a, SettingsResult<()>>;
    /// Remove one row; removing an absent row succeeds.
    fn delete<'a>(&'a self, category: &'a str, key: &'a str) -> BoxFuture<'a, SettingsResult<()>>;
}

/// An in-memory [`SettingsKv`]: a request-scoped snapshot of rows already
/// read, or a test store.
#[derive(Debug, Default)]
pub struct MemorySettings {
    rows: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl MemorySettings {
    /// A store holding `rows` under `category`.
    #[must_use]
    pub fn with_category(category: &str, rows: HashMap<String, String>) -> Self {
        Self {
            rows: Mutex::new(HashMap::from([(category.to_string(), rows)])),
        }
    }

    /// Builder: this store plus one row.
    #[must_use]
    pub fn with(self, category: &str, key: &str, value: &str) -> Self {
        self.insert(category, key, value);
        self
    }

    fn insert(&self, category: &str, key: &str, value: &str) {
        self.rows
            .lock_recover()
            .entry(category.to_string())
            .or_default()
            .insert(key.to_string(), value.to_string());
    }
}

impl SettingsKv for MemorySettings {
    fn get<'a>(
        &'a self,
        category: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, SettingsResult<Option<String>>> {
        let value = self
            .rows
            .lock_recover()
            .get(category)
            .and_then(|rows| rows.get(key))
            .cloned();
        Box::pin(async move { Ok(value) })
    }

    fn get_by_category<'a>(
        &'a self,
        category: &'a str,
    ) -> BoxFuture<'a, SettingsResult<HashMap<String, String>>> {
        let rows = self
            .rows
            .lock_recover()
            .get(category)
            .cloned()
            .unwrap_or_default();
        Box::pin(async move { Ok(rows) })
    }

    fn set<'a>(
        &'a self,
        category: &'a str,
        key: &'a str,
        value: &'a str,
    ) -> BoxFuture<'a, SettingsResult<()>> {
        self.insert(category, key, value);
        Box::pin(async { Ok(()) })
    }

    fn delete<'a>(&'a self, category: &'a str, key: &'a str) -> BoxFuture<'a, SettingsResult<()>> {
        if let Some(rows) = self.rows.lock_recover().get_mut(category) {
            rows.remove(key);
        }
        Box::pin(async { Ok(()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_settings_round_trips_rows_per_category() {
        let kv = MemorySettings::default().with("provider", "claude.defaultModel", "opus");
        kv.set("general", "worktreeDir", "trees").await.unwrap();

        assert_eq!(
            kv.get("provider", "claude.defaultModel").await.unwrap(),
            Some("opus".to_string())
        );
        assert_eq!(
            kv.get("general", "claude.defaultModel").await.unwrap(),
            None
        );
        assert_eq!(
            kv.get_by_category("general").await.unwrap(),
            HashMap::from([("worktreeDir".to_string(), "trees".to_string())])
        );

        kv.delete("general", "worktreeDir").await.unwrap();
        kv.delete("general", "absent").await.unwrap();
        assert_eq!(kv.get("general", "worktreeDir").await.unwrap(), None);
        assert!(kv.get_by_category("missing").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn with_category_snapshots_one_category() {
        let rows = HashMap::from([("codex.executablePath".to_string(), "/bin/codex".to_string())]);
        let kv: &dyn SettingsKv = &MemorySettings::with_category("provider", rows);
        assert_eq!(
            kv.get("provider", "codex.executablePath").await.unwrap(),
            Some("/bin/codex".to_string())
        );
        assert_eq!(
            kv.get("general", "codex.executablePath").await.unwrap(),
            None
        );
    }

    #[test]
    fn store_error_displays_its_cause() {
        assert_eq!(
            SettingsError::Store("disk I/O error".into()).to_string(),
            "settings store: disk I/O error"
        );
    }
}
