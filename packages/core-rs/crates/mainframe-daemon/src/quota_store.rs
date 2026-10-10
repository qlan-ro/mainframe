//! The daemon-side `QuotaSettingsStore` — the mirrored settings KV the
//! `QuotaManager` persists into, bridged onto the async `Db` actor via
//! `call_blocking` (the same SYNC-DB BRIDGE `DaemonPluginHostDb` uses).

use std::collections::HashMap;

use mainframe_server::db::Db;
use mainframe_services::quota::QuotaSettingsStore;

pub struct DaemonQuotaSettings {
    db: Db,
}

impl DaemonQuotaSettings {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl QuotaSettingsStore for DaemonQuotaSettings {
    fn get(&self, category: &str, key: &str) -> Option<String> {
        let (cat, key) = (category.to_string(), key.to_string());
        self.db
            .call_blocking(move |d| Ok(d.settings.get(&cat, &key).ok().flatten()))
            .ok()
            .flatten()
    }

    fn get_by_category(&self, category: &str) -> HashMap<String, String> {
        let cat = category.to_string();
        self.db
            .call_blocking(move |d| Ok(d.settings.get_by_category(&cat).unwrap_or_default()))
            .unwrap_or_default()
    }

    fn set(&self, category: &str, key: &str, value: &str) {
        let (cat, k, val) = (category.to_string(), key.to_string(), value.to_string());
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.settings.set(&cat, &k, &val))
        {
            tracing::warn!(%err, category, key, "quota settings.set failed");
        }
    }
}
