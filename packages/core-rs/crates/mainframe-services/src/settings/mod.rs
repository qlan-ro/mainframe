pub mod model_default;
pub mod provider_config;
#[cfg(test)]
pub(crate) mod test_support;

use mainframe_types::settings_kv::SettingsKv;

pub use model_default::normalize_saved_default_model;
pub use provider_config::get_provider_config;

/// One setting, for callers whose answer to a missing row is a built-in
/// default. A store failure is logged with its category and key and read as
/// unset, so the caller falls back to that same default.
pub async fn read_setting(settings: &dyn SettingsKv, category: &str, key: &str) -> Option<String> {
    match settings.get(category, key).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(%err, category, key, "settings read failed; using the default");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::settings_kv::MemorySettings;
    use test_support::FailingSettings;

    #[tokio::test]
    async fn read_setting_returns_the_stored_value_or_none() {
        let kv = MemorySettings::default().with("general", "worktreeDir", "trees");
        assert_eq!(
            read_setting(&kv, "general", "worktreeDir").await,
            Some("trees".to_string())
        );
        assert_eq!(read_setting(&kv, "general", "updateChannel").await, None);
    }

    #[tokio::test]
    async fn read_setting_reads_a_store_failure_as_unset() {
        assert_eq!(
            read_setting(&FailingSettings, "general", "worktreeDir").await,
            None
        );
    }
}
