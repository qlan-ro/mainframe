use mainframe_types::settings::{PROVIDER_CONFIG_FIELDS, ProviderConfig};
use mainframe_types::settings_kv::SettingsKv;
use serde_json::{Map, Value};

/// One adapter's typed provider settings, assembled from its `provider` rows
/// (`<adapterId>.<field>`). A store failure is logged and yields the empty
/// config (every field unset, so callers use their built-in defaults), as does
/// a stored value outside its enum.
pub async fn get_provider_config(settings: &dyn SettingsKv, adapter_id: &str) -> ProviderConfig {
    let rows = match settings.get_by_category("provider").await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(%err, category = "provider", adapter_id, "provider settings read failed; using defaults");
            return ProviderConfig::default();
        }
    };
    let mut cfg: Map<String, Value> = Map::new();
    for field in PROVIDER_CONFIG_FIELDS {
        if let Some(value) = rows.get(&format!("{adapter_id}.{field}")) {
            cfg.insert((*field).to_string(), Value::String(value.clone()));
        }
    }
    serde_json::from_value(Value::Object(cfg)).unwrap_or_default()
}

#[cfg(test)]
#[path = "provider_config_tests.rs"]
mod tests;
